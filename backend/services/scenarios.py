"""Shared scenario operations for evaluate and the future explain endpoint."""

from dataclasses import dataclass

from backend.domain.models import (
    Dataset, ScenarioReport, Selection, SimulationResult, ValidationError, ValidationResult,
)
from backend.domain.report import build_report
from backend.domain.simulation import simulate
from backend.domain.validation import validate_scenario


class ModelVersionMismatch(Exception):
    """The caller used a different simulation dataset version."""


class InvalidScenario(Exception):
    """A final scenario failed one or more domain rules."""

    def __init__(self, errors: tuple[ValidationError, ...]) -> None:
        self.errors = errors
        super().__init__("Invalid final scenario")


@dataclass(frozen=True, slots=True)
class ScenarioService:
    dataset: Dataset
    baseline: SimulationResult

    def _check_version(self, model_version: str) -> None:
        if model_version != self.dataset.model_version:
            raise ModelVersionMismatch

    def validate_draft(
        self, model_version: str, selections: tuple[Selection, ...]
    ) -> ValidationResult:
        self._check_version(model_version)
        return validate_scenario(self.dataset, selections, final=False)

    def evaluate(
        self, model_version: str, selections: tuple[Selection, ...]
    ) -> ScenarioReport:
        self._check_version(model_version)
        validation = validate_scenario(self.dataset, selections, final=True)
        if not validation.can_evaluate:
            raise InvalidScenario(validation.errors)
        simulation = simulate(self.dataset, selections)
        return build_report(self.dataset, selections, simulation, self.baseline)
