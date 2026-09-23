"""Deterministic, clearly labeled explanation from a calculated report."""

from backend.services.explanations import ExplanationFacts, ExplanationFailureReason
from shared.schemas import ExplainResponse, ExplanationSchema, WarningSchema


def template_explanation(facts: ExplanationFacts) -> ExplanationSchema:
    report = facts.report
    names = {district["id"]: district["name"] for district in facts.context["after"]["districts"]}
    comparison = (
        f"выше базового на {report.score_delta}" if report.score_delta > 0 else
        f"ниже базового на {abs(report.score_delta)}" if report.score_delta < 0 else
        "равен базовому"
    )
    summary = (
        f"Синтетический Score: {report.after.score} (база {report.baseline.score}); "
        f"результат {comparison}. "
        "Это результат модели, а не прогноз для реального города."
    )

    strengths = []
    improved = [
        (before, after)
        for before, after in zip(report.baseline.districts, report.after.districts)
        if after.district_score > before.district_score
    ]
    if improved:
        strengths.append("Районная оценка выросла: " + ", ".join(
            f"{names[after.id]} ({before.district_score} → {after.district_score})"
            for before, after in improved
        ) + ".")
    improved_indicators = [change for change in report.indicator_changes if change.delta > 0]
    if improved_indicators:
        strengths.append("Выросли показатели: " + ", ".join(
            f"{names[change.district_id]} — {change.indicator} "
            f"({change.before} → {change.after})" for change in improved_indicators
        ) + ".")
    resolved = facts.context["resolved_critical_pairs"]
    if resolved:
        strengths.append("Перестали быть критическими пары: " + ", ".join(
            f"{names[pair['district_id']]} — {pair['indicator']}"
            for pair in resolved
        ) + ".")
    if report.synergy_effects:
        strengths.append("В расчёте сработали синергии: " + ", ".join(
            f"{effect.first_measure_id} + {effect.second_measure_id} "
            f"для {names[effect.district_id]} ({effect.indicator}: +{effect.bonus} до ограничения)"
            for effect in report.synergy_effects
        ) + ".")
    if not strengths:
        strengths.append("Сценарий рассчитан по выбранным решениям; роста районных оценок и снятых критических пар отчёт не показывает.")

    risks = []
    if report.after.critical_pairs:
        risks.append("Критические значения остаются: " + ", ".join(
            f"{names[pair.district_id]} — {pair.indicator} ({pair.value})"
            for pair in report.after.critical_pairs
        ) + ".")
    if report.after.weakest_district_ids:
        risks.append("Наименьшая районная оценка — " + ", ".join(
            names[district_id] for district_id in report.after.weakest_district_ids
        ) + f" ({report.after.minimum}).")
    declines = [change for change in report.indicator_changes if change.delta < 0]
    if declines:
        risks.append("Снизились показатели: " + ", ".join(
            f"{names[change.district_id]} — {change.indicator} "
            f"({change.before} → {change.after})" for change in declines
        ) + ".")

    recommendations = []
    if report.after.critical_pairs:
        pairs = ", ".join(
            f"{names[pair.district_id]} — {pair.indicator}"
            for pair in report.after.critical_pairs
        )
        recommendations.append(
            f"При следующем выборе мер изучите каталог для оставшихся критических пар: {pairs}. "
            "Влияние нового набора требует отдельного расчёта."
        )
    else:
        weakest = ", ".join(names[district_id] for district_id in report.after.weakest_district_ids)
        recommendations.append(
            f"При следующем выборе мер обратите внимание на район с наименьшей оценкой: {weakest}. "
            "Влияние альтернативы требует отдельного расчёта."
        )
    return ExplanationSchema(
        summary=summary, strengths=strengths, risks=risks, recommendations=recommendations,
    )


def fallback_response(facts: ExplanationFacts, reason: ExplanationFailureReason) -> ExplainResponse:
    return ExplainResponse(
        model_version=facts.report.model_version,
        scenario_key=facts.report.scenario_key,
        mode="fallback",
        llm_model=None,
        explanation=template_explanation(facts),
        warning=WarningSchema(
            code=reason.value,
            message="AI недоступен: показано шаблонное объяснение",
        ),
    )
