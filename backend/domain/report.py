"""Build a numerical scenario report from baseline and scenario calculations."""

from backend.domain.models import (
    Budget,
    Dataset,
    IndicatorChange,
    ScenarioReport,
    Selection,
    SimulationResult,
)
from backend.domain.simulation import canonical_selections


def build_report(
    dataset: Dataset,
    selections: tuple[Selection, ...],
    simulation: SimulationResult,
    baseline: SimulationResult,
) -> ScenarioReport:
    """Package actual indicator deltas separately from pre-clip additions."""
    ordered = canonical_selections(selections)
    spent = sum(dataset.measures[selection.measure_id].cost for selection in ordered)
    budget = Budget(dataset.rules.budget_limit, spent, dataset.rules.budget_limit - spent)
    scenario_key = "|".join((
        dataset.model_version,
        *(f"{selection.measure_id}@{selection.district_id or 'city'}" for selection in ordered),
    ))

    before_by_id = {district.id: district for district in baseline.after.districts}
    after = simulation.after
    changes = tuple(
        IndicatorChange(
            district.id,
            indicator,
            before_by_id[district.id].indicators[indicator],
            value,
            value - before_by_id[district.id].indicators[indicator],
        )
        for district in after.districts
        for indicator, value in district.indicators.items()
    )
    return ScenarioReport(
        dataset.model_version,
        scenario_key,
        ordered,
        budget,
        baseline.after,
        after,
        after.score - baseline.after.score,
        changes,
        simulation.measure_effects,
        simulation.synergy_effects,
    )
