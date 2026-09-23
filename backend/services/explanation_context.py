"""Small, scope-specific AI facts derived only from the server calculation."""

from typing import Any

from backend.domain.models import Dataset, ScenarioReport


INDICATOR_NAMES = {
    "T1": "Разгрузка дорог", "T2": "Доступность общественного транспорта",
    "E1": "Озеленение", "E2": "Качество воздуха", "S1": "Школы и детсады",
    "S2": "Поликлиники и первичная медпомощь", "B1": "Безопасность улиц",
    "B2": "Безопасность дорожного движения", "C1": "Надёжность ЖКХ",
    "C2": "Скорость решения обращений жителей",
}


def build_ai_context(
    report: ScenarioReport, dataset: Dataset, district_id: str | None = None,
) -> dict[str, Any]:
    """Round only presentation facts; keep the authoritative report untouched."""
    if report.model_version != dataset.model_version:
        raise ValueError("Report and dataset model versions differ")
    if district_id is not None and district_id not in dataset.districts:
        raise ValueError("Unknown explanation district")
    before = {district.id: district for district in report.baseline.districts}
    after = {district.id: district for district in report.after.districts}
    relevant = [change for change in report.indicator_changes
                if district_id is None or change.district_id == district_id]

    def change_fact(change) -> dict[str, Any]:
        return {
            "district_id": change.district_id,
            "indicator": change.indicator,
            "before": round(change.before, 2), "after": round(change.after, 2),
            "delta": round(change.delta, 2),
        }

    def score_fact(snapshot) -> dict[str, Any]:
        if district_id is not None:
            district = next(item for item in snapshot.districts if item.id == district_id)
            return {"score": round(district.district_score, 2), "critical_count": sum(
                pair.district_id == district_id for pair in snapshot.critical_pairs
            )}
        return {
            "score": round(snapshot.score, 2), "average": round(snapshot.average, 2),
            "minimum": round(snapshot.minimum, 2), "critical_count": len(snapshot.critical_pairs),
        }

    before_score, after_score = score_fact(report.baseline), score_fact(report.after)
    raw_delta = (
        after[district_id].district_score - before[district_id].district_score
        if district_id is not None else report.score_delta
    )
    context = {
        "scope": {"district_id": district_id, "name": dataset.districts[district_id].name if district_id else "Астана"},
        "horizon_quarters": dataset.rules.horizon_quarters,
        "city_budget": {"limit": report.budget.limit, "spent": report.budget.spent},
        "before": before_score, "after": after_score, "score_delta": round(raw_delta, 2),
        "top_changes": [change_fact(change) for change in sorted(
            relevant, key=lambda item: abs(item.delta), reverse=True,
        )[:4]],
        "weak_spots": [change_fact(change) for change in sorted(relevant, key=lambda item: item.after)[:3]],
        "decisions": [
            {"id": selection.measure_id, "title": dataset.measures[selection.measure_id].title,
             "district_id": selection.district_id, "lag": dataset.measures[selection.measure_id].lag}
            for selection in report.selections
            if district_id is None or selection.district_id in (None, district_id)
        ],
        "synergies": [
            {"measures": [effect.first_measure_id, effect.second_measure_id],
             "district_id": effect.district_id, "indicator": effect.indicator, "bonus": round(effect.bonus, 2)}
            for effect in report.synergy_effects if district_id is None or effect.district_id == district_id
        ],
        "indicator_names": INDICATOR_NAMES,
        "rules": {
            "higher_is_better": True, "critical_threshold": dataset.rules.critical_threshold,
            "required_decisions": dataset.rules.required_decisions, "max_per_direction": dataset.rules.max_per_direction,
            "conflicts": [
                {"measures": [rule.first_measure_id, rule.second_measure_id], "scope": rule.scope}
                for rule in dataset.rules.conflicts
            ],
        },
        "recommendation_catalog": [
            {"id": measure.id, "title": measure.title, "scope": measure.scope,
             "cost": measure.cost, "lag": measure.lag, "effects": dict(measure.effects)}
            for measure in dataset.measures.values()
        ],
    }
    if district_id is None:
        context["districts"] = [
            {"id": identifier, "name": dataset.districts[identifier].name,
             "before": round(before[identifier].district_score, 2), "after": round(district.district_score, 2)}
            for identifier, district in after.items()
        ]
    else:
        context["indicators"] = [change_fact(change) for change in relevant]
    return context
