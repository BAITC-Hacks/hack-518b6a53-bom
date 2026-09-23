"""Server-owned facts and the asynchronous explanation boundary."""

from dataclasses import dataclass
from copy import deepcopy
from enum import Enum
from typing import Any, Protocol

from pydantic import ValidationError as SchemaValidationError

from backend.domain.models import ScenarioReport, Selection, ValidationError
from backend.services.explanation_context import build_ai_context
from backend.services.scenarios import InvalidScenario, ScenarioService
from shared.schemas import ExplainResponse, ExplanationLanguage, ExplanationSchema


class ExplanationFailureReason(str, Enum):
    AI_NOT_CONFIGURED = "AI_NOT_CONFIGURED"
    AI_BUSY = "AI_BUSY"
    AI_TIMEOUT = "AI_TIMEOUT"
    AI_UNAVAILABLE = "AI_UNAVAILABLE"
    AI_INVALID_RESPONSE = "AI_INVALID_RESPONSE"


@dataclass(frozen=True, slots=True)
class ExplanationFacts:
    """The report is authoritative; context is its compact presentation."""

    report: ScenarioReport
    context: dict[str, Any]
    language: ExplanationLanguage = "ru"
    district_id: str | None = None


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


def _checked_success(result: ExplanationSuccess) -> ExplanationSchema | None:
    if not isinstance(result.llm_model, str) or not result.llm_model.strip():
        return None
    try:
        raw = result.explanation.model_dump() if isinstance(result.explanation, ExplanationSchema) else result.explanation
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
        language: ExplanationLanguage = "ru", district_id: str | None = None,
    ) -> ExplainResponse:
        """Validate scope and scenario, calculate, then explain the selected scope."""
        report = self.scenarios.evaluate(model_version, selections)
        if district_id is not None and district_id not in self.scenarios.dataset.districts:
            raise InvalidScenario((ValidationError("UNKNOWN_DISTRICT", "Неизвестный район", "district_id"),))
        facts = ExplanationFacts(
            report, build_ai_context(report, self.scenarios.dataset, district_id), language, district_id,
        )
        result = await self.adapter.explain(ExplanationFacts(report, deepcopy(facts.context), language, district_id))
        if isinstance(result, ExplanationSuccess):
            explanation = _checked_success(result)
            if explanation is not None:
                return ExplainResponse(
                    model_version=report.model_version, scenario_key=report.scenario_key,
                    language=language, district_id=district_id,
                    mode="llm", llm_model=result.llm_model, explanation=explanation, warning=None,
                )
            reason = ExplanationFailureReason.AI_INVALID_RESPONSE
        elif isinstance(result, ExplanationFailure):
            reason = result.reason
        else:
            reason = ExplanationFailureReason.AI_INVALID_RESPONSE
        from backend.adapters.fallback import fallback_response

        return fallback_response(facts, reason)
