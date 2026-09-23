"""Immutable values used by the Tech2 validation and simulation core.

All mappings are copied before wrapping, so a caller cannot mutate a loaded
dataset through either the original input dictionary or the resulting model.
Business validation belongs to the future dataset loader and validator.
"""

from dataclasses import dataclass
from types import MappingProxyType
from typing import Literal, Mapping


Direction = Literal["transport", "ecology", "social", "safety", "services"]
Scope = Literal["district", "city"]
ConflictScope = Literal["global", "same_district"]


def _freeze_mapping(values: Mapping[str, float]) -> Mapping[str, float]:
    return MappingProxyType(dict(values))


@dataclass(frozen=True, slots=True)
class District:
    id: str
    name: str
    population_share: float
    indicators: Mapping[str, float]

    def __post_init__(self) -> None:
        object.__setattr__(self, "indicators", _freeze_mapping(self.indicators))


@dataclass(frozen=True, slots=True)
class Measure:
    id: str
    title: str
    direction: Direction
    scope: Scope
    cost: int
    lag: int
    effects: Mapping[str, float]

    def __post_init__(self) -> None:
        object.__setattr__(self, "effects", _freeze_mapping(self.effects))


@dataclass(frozen=True, slots=True)
class Synergy:
    first_measure_id: str
    second_measure_id: str
    indicator: str
    bonus: float


@dataclass(frozen=True, slots=True)
class Conflict:
    first_measure_id: str
    second_measure_id: str
    scope: ConflictScope


@dataclass(frozen=True, slots=True)
class Rules:
    budget_limit: int
    required_decisions: int
    max_per_direction: int
    horizon_quarters: int
    critical_threshold: float
    critical_penalty: float
    average_weight: float
    minimum_weight: float
    indicator_weights: Mapping[str, float]
    synergies: tuple[Synergy, ...]
    conflicts: tuple[Conflict, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "indicator_weights", _freeze_mapping(self.indicator_weights))
        object.__setattr__(self, "synergies", tuple(self.synergies))
        object.__setattr__(self, "conflicts", tuple(self.conflicts))


@dataclass(frozen=True, slots=True)
class Selection:
    measure_id: str
    district_id: str | None = None


@dataclass(frozen=True, slots=True)
class Preset:
    id: str
    title: str
    selections: tuple[Selection, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "selections", tuple(self.selections))


@dataclass(frozen=True, slots=True)
class Dataset:
    model_version: str
    districts: Mapping[str, District]
    measures: Mapping[str, Measure]
    rules: Rules
    presets: tuple[Preset, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "districts", MappingProxyType(dict(self.districts)))
        object.__setattr__(self, "measures", MappingProxyType(dict(self.measures)))
        object.__setattr__(self, "presets", tuple(self.presets))


@dataclass(frozen=True, slots=True)
class ValidationError:
    code: str
    message: str
    path: str


@dataclass(frozen=True, slots=True)
class Budget:
    limit: int
    spent: int | None
    remaining: int | None


@dataclass(frozen=True, slots=True)
class ValidationResult:
    valid_draft: bool
    can_evaluate: bool
    budget: Budget
    errors: tuple[ValidationError, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "errors", tuple(self.errors))


@dataclass(frozen=True, slots=True)
class DistrictSnapshot:
    id: str
    district_score: float
    indicators: Mapping[str, float]

    def __post_init__(self) -> None:
        object.__setattr__(self, "indicators", _freeze_mapping(self.indicators))


@dataclass(frozen=True, slots=True)
class CriticalPair:
    district_id: str
    indicator: str
    value: float


@dataclass(frozen=True, slots=True)
class Snapshot:
    score: float
    average: float
    minimum: float
    weakest_district_ids: tuple[str, ...]
    districts: tuple[DistrictSnapshot, ...]
    critical_pairs: tuple[CriticalPair, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "weakest_district_ids", tuple(self.weakest_district_ids))
        object.__setattr__(self, "districts", tuple(self.districts))
        object.__setattr__(self, "critical_pairs", tuple(self.critical_pairs))


@dataclass(frozen=True, slots=True)
class IndicatorChange:
    district_id: str
    indicator: str
    before: float
    after: float
    delta: float


@dataclass(frozen=True, slots=True)
class MeasureEffect:
    measure_id: str
    district_id: str | None
    cost: int
    lag: int
    realized_fraction: float
    additions: Mapping[str, Mapping[str, float]]

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "additions",
            MappingProxyType(
                {
                    district_id: _freeze_mapping(indicators)
                    for district_id, indicators in self.additions.items()
                }
            ),
        )


@dataclass(frozen=True, slots=True)
class SynergyEffect:
    first_measure_id: str
    second_measure_id: str
    district_id: str
    indicator: str
    bonus: float


@dataclass(frozen=True, slots=True)
class SimulationResult:
    after: Snapshot
    measure_effects: tuple[MeasureEffect, ...]
    synergy_effects: tuple[SynergyEffect, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "measure_effects", tuple(self.measure_effects))
        object.__setattr__(self, "synergy_effects", tuple(self.synergy_effects))


@dataclass(frozen=True, slots=True)
class ScenarioReport:
    model_version: str
    scenario_key: str
    selections: tuple[Selection, ...]
    budget: Budget
    baseline: Snapshot
    after: Snapshot
    score_delta: float
    indicator_changes: tuple[IndicatorChange, ...]
    measure_effects: tuple[MeasureEffect, ...]
    synergy_effects: tuple[SynergyEffect, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "selections", tuple(self.selections))
        object.__setattr__(self, "indicator_changes", tuple(self.indicator_changes))
        object.__setattr__(self, "measure_effects", tuple(self.measure_effects))
        object.__setattr__(self, "synergy_effects", tuple(self.synergy_effects))
