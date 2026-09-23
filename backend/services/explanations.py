"""Server-owned facts and the asynchronous explanation boundary."""

from dataclasses import dataclass
from copy import deepcopy
from enum import Enum
from typing import Any, Protocol

from pydantic import ValidationError as SchemaValidationError

from backend.domain.models import Dataset, ScenarioReport, Selection, Snapshot
from backend.services.scenarios import ScenarioService
from shared.schemas import ExplainResponse, ExplanationLanguage, ExplanationSchema


class ExplanationFailureReason(str, Enum):
    AI_NOT_CONFIGURED = "AI_NOT_CONFIGURED"
    AI_BUSY = "AI_BUSY"
    AI_TIMEOUT = "AI_TIMEOUT"
    AI_UNAVAILABLE = "AI_UNAVAILABLE"
    AI_INVALID_RESPONSE = "AI_INVALID_RESPONSE"


@dataclass(frozen=True, slots=True)
class ExplanationFacts:
    """The report is authoritative; context is its JSON-ready presentation."""

    report: ScenarioReport
    context: dict[str, Any]
    language: ExplanationLanguage = "ru"


@dataclass(frozen=True, slots=True)
class ExplanationSuccess:
    explanation: ExplanationSchema
    llm_model: str


@dataclass(frozen=True, slots=True)
class ExplanationFailure:
    reason: ExplanationFailureReason


class ExplanationAdapter(Protocol):
    async def explain(self, facts: ExplanationFacts) -> ExplanationSuccess | ExplanationFailure:
        """Explain server facts, or state a typed reason for failure."""


def _snapshot_facts(snapshot: Snapshot, dataset: Dataset) -> dict[str, Any]:
    rules = dataset.rules
    return {
        "score": snapshot.score,
        "average": snapshot.average,
        "minimum": snapshot.minimum,
        "weakest_district_ids": list(snapshot.weakest_district_ids),
        "critical_count": len(snapshot.critical_pairs),
        "score_parts": {
            "weighted_average": rules.average_weight * snapshot.average,
            "weighted_minimum": rules.minimum_weight * snapshot.minimum,
            "critical_penalty": rules.critical_penalty * len(snapshot.critical_pairs),
        },
        "districts": [
            {"id": district.id, "name": dataset.districts[district.id].name,
             "district_score": district.district_score, "indicators": dict(district.indicators)}
            for district in snapshot.districts
        ],
        "critical_pairs": [
            {"district_id": pair.district_id, "indicator": pair.indicator, "value": pair.value}
            for pair in snapshot.critical_pairs
        ],
    }


def build_ai_context(report: ScenarioReport, dataset: Dataset) -> dict[str, Any]:
    """Package only versioned catalog data and Python-calculated report values."""
    if report.model_version != dataset.model_version:
        raise ValueError("Report and dataset model versions differ")
    measure_effects = {effect.measure_id: effect for effect in report.measure_effects}
    before_pairs = {(pair.district_id, pair.indicator) for pair in report.baseline.critical_pairs}
    after_pairs = {(pair.district_id, pair.indicator) for pair in report.after.critical_pairs}
    return {
        "model_version": report.model_version,
        "scenario_key": report.scenario_key,
        "simulation_horizon_quarters": dataset.rules.horizon_quarters,
        "budget": {"limit": report.budget.limit, "spent": report.budget.spent,
                   "remaining": report.budget.remaining},
        "decisions": [
            {
                "measure_id": selection.measure_id,
                "title": dataset.measures[selection.measure_id].title,
                "direction": dataset.measures[selection.measure_id].direction,
                "scope": dataset.measures[selection.measure_id].scope,
                "district_id": selection.district_id,
                "cost": measure_effects[selection.measure_id].cost,
                "lag": measure_effects[selection.measure_id].lag,
                "full_effects_before_lag": dict(dataset.measures[selection.measure_id].effects),
                "realized_fraction": measure_effects[selection.measure_id].realized_fraction,
                "additions_after_lag_before_clip": {
                    district_id: dict(indicators)
                    for district_id, indicators in measure_effects[selection.measure_id].additions.items()
                },
            }
            for selection in report.selections
        ],
        "synergy_effects_before_clip": [
            {"first_measure_id": effect.first_measure_id,
             "second_measure_id": effect.second_measure_id,
             "district_id": effect.district_id, "indicator": effect.indicator,
             "bonus": effect.bonus}
            for effect in report.synergy_effects
        ],
        "before": _snapshot_facts(report.baseline, dataset),
        "after": _snapshot_facts(report.after, dataset),
        "score_delta": report.score_delta,
        "indicator_changes_after_clip": [
            {"district_id": change.district_id, "indicator": change.indicator,
             "before": change.before, "after": change.after, "delta": change.delta}
            for change in report.indicator_changes
        ],
        "resolved_critical_pairs": [
            {"district_id": pair.district_id, "indicator": pair.indicator, "value_before": pair.value}
            for pair in report.baseline.critical_pairs
            if (pair.district_id, pair.indicator) not in after_pairs
        ],
        "new_critical_pairs": [
            {"district_id": pair.district_id, "indicator": pair.indicator, "value_after": pair.value}
            for pair in report.after.critical_pairs
            if (pair.district_id, pair.indicator) not in before_pairs
        ],
        "score_rules": {
            "average_weight": dataset.rules.average_weight,
            "minimum_weight": dataset.rules.minimum_weight,
            "critical_threshold": dataset.rules.critical_threshold,
            "critical_penalty_per_pair": dataset.rules.critical_penalty,
            "indicator_weights": dict(dataset.rules.indicator_weights),
            "max_per_direction": dataset.rules.max_per_direction,
            "required_decisions": dataset.rules.required_decisions,
            "conflicts": [
                {"first_measure_id": conflict.first_measure_id,
                 "second_measure_id": conflict.second_measure_id, "scope": conflict.scope}
                for conflict in dataset.rules.conflicts
            ],
        },
        "recommendation_catalog": [
            {"id": measure.id, "title": measure.title, "direction": measure.direction,
             "scope": measure.scope, "cost": measure.cost, "lag": measure.lag,
             "effects": dict(measure.effects)}
            for measure in dataset.measures.values()
        ],
    }


def _checked_success(result: ExplanationSuccess) -> ExplanationSchema | None:
    if not isinstance(result.llm_model, str) or not result.llm_model.strip():
        return None
    try:
        raw = (
            result.explanation.model_dump()
            if isinstance(result.explanation, ExplanationSchema)
            else result.explanation
        )
        explanation = ExplanationSchema.model_validate(raw)
    except SchemaValidationError:
        return None
    if not explanation.summary.strip():
        return None
    for items in (explanation.strengths, explanation.risks, explanation.recommendations):
        if any(not item.strip() for item in items):
            return None
    return explanation


@dataclass(frozen=True, slots=True)
class ExplanationService:
    scenarios: ScenarioService
    adapter: ExplanationAdapter

    async def explain(
        self, model_version: str, selections: tuple[Selection, ...],
        language: ExplanationLanguage = "ru",
    ) -> ExplainResponse:
        """Validate, recalculate, form facts, then ask the explanation adapter."""
        report = self.scenarios.evaluate(model_version, selections)
        facts = ExplanationFacts(report, build_ai_context(report, self.scenarios.dataset), language)
        result = await self.adapter.explain(ExplanationFacts(report, deepcopy(facts.context), language))
        if isinstance(result, ExplanationSuccess):
            explanation = _checked_success(result)
            if explanation is not None:
                return ExplainResponse(
                    model_version=report.model_version, scenario_key=report.scenario_key,
                    language=language,
                    mode="llm", llm_model=result.llm_model, explanation=explanation, warning=None,
                )
            reason = ExplanationFailureReason.AI_INVALID_RESPONSE
        elif isinstance(result, ExplanationFailure):
            reason = result.reason
        else:
            reason = ExplanationFailureReason.AI_INVALID_RESPONSE
        from backend.adapters.fallback import fallback_response

        return fallback_response(facts, reason)
