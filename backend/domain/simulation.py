"""Deterministic Tech2 calculations over the versioned dataset."""

import math

from backend.domain.models import (
    CriticalPair,
    Dataset,
    DistrictSnapshot,
    MeasureEffect,
    Selection,
    SimulationResult,
    Snapshot,
    SynergyEffect,
)
from backend.domain.validation import validate_scenario


def canonical_selections(selections: tuple[Selection, ...]) -> tuple[Selection, ...]:
    """Put catalog measure IDs in numerical order, independent of input order."""
    return tuple(sorted(selections, key=lambda selection: int(selection.measure_id[1:])))


def simulate(dataset: Dataset, selections: tuple[Selection, ...]) -> SimulationResult:
    """Calculate a final scenario, or the internal empty baseline.

    All additions are accumulated before indicators are clipped once. A new
    calculation always begins with the original district indicators.
    """
    if selections and not validate_scenario(dataset, selections, final=True).can_evaluate:
        raise ValueError("Cannot simulate an invalid final scenario")

    ordered = canonical_selections(selections)
    rules = dataset.rules
    raw = {
        district_id: dict(district.indicators)
        for district_id, district in dataset.districts.items()
    }
    measure_effects: list[MeasureEffect] = []
    selected = {selection.measure_id: selection for selection in ordered}

    for selection in ordered:
        measure = dataset.measures[selection.measure_id]
        fraction = (rules.horizon_quarters - measure.lag) / rules.horizon_quarters
        target_ids = (
            (selection.district_id,)
            if measure.scope == "district"
            else tuple(dataset.districts)
        )
        additions: dict[str, dict[str, float]] = {}
        for district_id in target_ids:
            additions[district_id] = {}
            for indicator, effect in measure.effects.items():
                addition = effect * fraction
                additions[district_id][indicator] = addition
                raw[district_id][indicator] += addition
        measure_effects.append(MeasureEffect(
            measure.id, selection.district_id, measure.cost, measure.lag,
            fraction, additions,
        ))

    synergy_effects: list[SynergyEffect] = []
    for synergy in rules.synergies:
        first = selected.get(synergy.first_measure_id)
        if first is None or synergy.second_measure_id not in selected:
            continue
        # Versioned data defines the first measure of each pair as district scoped.
        district_id = first.district_id
        if district_id is None:
            raise ValueError("Synergy first measure must target a district")
        raw[district_id][synergy.indicator] += synergy.bonus
        synergy_effects.append(SynergyEffect(
            synergy.first_measure_id, synergy.second_measure_id,
            district_id, synergy.indicator, synergy.bonus,
        ))

    districts: list[DistrictSnapshot] = []
    critical_pairs: list[CriticalPair] = []
    for district_id in dataset.districts:
        indicators = {
            indicator: min(100, max(0, value))
            for indicator, value in raw[district_id].items()
        }
        district_score = sum(
            weight * indicators[indicator]
            for indicator, weight in rules.indicator_weights.items()
        )
        districts.append(DistrictSnapshot(district_id, district_score, indicators))
        for indicator, value in indicators.items():
            if value < rules.critical_threshold:
                critical_pairs.append(CriticalPair(district_id, indicator, value))

    average = sum(
        dataset.districts[district.id].population_share * district.district_score
        for district in districts
    )
    minimum = min(district.district_score for district in districts)
    weakest = tuple(
        district.id for district in districts
        if math.isclose(district.district_score, minimum, rel_tol=0.0, abs_tol=1e-8)
    )
    score = (
        rules.average_weight * average
        + rules.minimum_weight * minimum
        - rules.critical_penalty * len(critical_pairs)
    )
    snapshot = Snapshot(score, average, minimum, weakest, tuple(districts), tuple(critical_pairs))
    return SimulationResult(snapshot, tuple(measure_effects), tuple(synergy_effects))
