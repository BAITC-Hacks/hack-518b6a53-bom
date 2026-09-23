"""Pydantic v2 HTTP contracts. Business rules remain in backend.domain."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator


class StrictSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SelectionSchema(StrictSchema):
    measure_id: str
    district_id: str | None = None

    @model_validator(mode="before")
    @classmethod
    def reject_explicit_null_district(cls, value: object) -> object:
        if isinstance(value, dict) and "district_id" in value and value["district_id"] is None:
            raise ValueError("district_id must be omitted rather than null")
        return value


class ScenarioRequest(StrictSchema):
    model_version: str
    selections: list[SelectionSchema]


class ErrorSchema(StrictSchema):
    code: str
    message: str
    path: str


class ErrorResponse(StrictSchema):
    errors: list[ErrorSchema]
    score: None


class BudgetSchema(StrictSchema):
    limit: int
    spent: int | None
    remaining: int | None


class DistrictCatalogSchema(StrictSchema):
    id: str
    name: str
    population_share: float
    indicators: dict[str, float]


class MeasureCatalogSchema(StrictSchema):
    id: str
    title: str
    direction: Literal["transport", "ecology", "social", "safety", "services"]
    scope: Literal["district", "city"]
    cost: int
    lag: int
    effects: dict[str, float]


class SynergyRuleSchema(StrictSchema):
    first_measure_id: str
    second_measure_id: str
    indicator: str
    bonus: float


class ConflictRuleSchema(StrictSchema):
    first_measure_id: str
    second_measure_id: str
    scope: Literal["global", "same_district"]


class PublicRulesSchema(StrictSchema):
    budget_limit: int
    required_decisions: int
    max_per_direction: int
    horizon_quarters: int
    critical_threshold: float
    critical_penalty: float
    average_weight: float
    minimum_weight: float
    indicator_weights: dict[str, float]
    synergies: list[SynergyRuleSchema]
    conflicts: list[ConflictRuleSchema]


class PresetSchema(StrictSchema):
    id: str
    title: str
    selections: list[SelectionSchema]


class DistrictSnapshotSchema(StrictSchema):
    id: str
    district_score: float
    indicators: dict[str, float]


class CriticalPairSchema(StrictSchema):
    district_id: str
    indicator: str
    value: float


class SnapshotSchema(StrictSchema):
    score: float
    average: float
    minimum: float
    weakest_district_ids: list[str]
    districts: list[DistrictSnapshotSchema]
    critical_pairs: list[CriticalPairSchema]


class CatalogResponse(StrictSchema):
    model_version: str
    districts: list[DistrictCatalogSchema]
    measures: list[MeasureCatalogSchema]
    rules: PublicRulesSchema
    baseline: SnapshotSchema
    presets: list[PresetSchema]


class ValidateResponse(StrictSchema):
    model_version: str
    valid_draft: bool
    can_evaluate: bool
    budget: BudgetSchema
    errors: list[ErrorSchema]


class IndicatorChangeSchema(StrictSchema):
    district_id: str
    indicator: str
    before: float
    after: float
    delta: float


class MeasureEffectSchema(StrictSchema):
    measure_id: str
    district_id: str | None
    cost: int
    lag: int
    realized_fraction: float
    additions: dict[str, dict[str, float]]


class SynergyEffectSchema(StrictSchema):
    first_measure_id: str
    second_measure_id: str
    district_id: str
    indicator: str
    bonus: float


class EvaluateResponse(StrictSchema):
    model_version: str
    scenario_key: str
    selections: list[SelectionSchema]
    budget: BudgetSchema
    baseline: SnapshotSchema
    after: SnapshotSchema
    score_delta: float
    indicator_changes: list[IndicatorChangeSchema]
    measure_effects: list[MeasureEffectSchema]
    synergy_effects: list[SynergyEffectSchema]


class ExplanationSchema(StrictSchema):
    summary: str
    strengths: list[str]
    risks: list[str]
    recommendations: list[str]


class WarningSchema(StrictSchema):
    code: str
    message: str


class ExplainResponse(StrictSchema):
    model_version: str
    scenario_key: str
    mode: Literal["llm", "fallback"]
    llm_model: str | None
    explanation: ExplanationSchema
    warning: WarningSchema | None


class LiveHealthResponse(StrictSchema):
    status: Literal["live"]


class ReadyHealthResponse(StrictSchema):
    status: Literal["ready", "not_ready"]


class AIHealthResponse(StrictSchema):
    configured: bool
    model: str | None
    last_status: Literal["not_checked", "ok", "error"]
    last_checked_at: str | None
