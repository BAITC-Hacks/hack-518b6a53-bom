"""Localized, deterministic explanations from the authoritative report."""

from backend.services.explanations import ExplanationFacts, ExplanationFailureReason
from shared.schemas import ExplainResponse, ExplanationSchema, WarningSchema


TEXT = {
    "ru": {
        "summary": "Оценка модели: {after} (база {before}); результат {comparison}. Это результат модели, а не прогноз для реального города.",
        "higher": "выше базового на {delta}", "lower": "ниже базового на {delta}", "equal": "равен базовому",
        "districts": "Районная оценка выросла: ", "indicators": "Выросли показатели: ",
        "resolved": "Перестали быть критическими пары: ", "synergies": "В расчёте сработали синергии: ",
        "synergy": "{first} + {second} для {district} ({indicator}: +{bonus} до ограничения)",
        "unchanged": "Сценарий рассчитан по выбранным решениям; роста районных оценок и снятых критических пар отчёт не показывает.",
        "critical": "Критические значения остаются: ", "weakest": "Наименьшая районная оценка: ",
        "declines": "Снизились показатели: ",
        "recommend_critical": "При следующем выборе мер изучите каталог для оставшихся критических пар: {pairs}. Влияние нового набора требует отдельного расчёта.",
        "recommend_weakest": "При следующем выборе мер обратите внимание на район с наименьшей оценкой: {districts}. Влияние альтернативы требует отдельного расчёта.",
        "warning": "AI недоступен: показано шаблонное объяснение",
    },
    "kk": {
        "summary": "Модель бағасы: {after} (бастапқы баға {before}); нәтиже {comparison}. Бұл нақты қаланың болжамы емес, модель нәтижесі.",
        "higher": "бастапқы мәннен {delta} жоғары", "lower": "бастапқы мәннен {delta} төмен", "equal": "бастапқы мәнге тең",
        "districts": "Аудан бағасы өсті: ", "indicators": "Көрсеткіштер өсті: ",
        "resolved": "Сыни деңгейден шыққан жұптар: ", "synergies": "Есепте синергия әсер етті: ",
        "synergy": "{district}: {first} + {second} ({indicator}: шектеуге дейін +{bonus})",
        "unchanged": "Сценарий таңдалған шаралар бойынша есептелді; аудандар бағасының өсуі немесе сыни жұптардың азаюы байқалмады.",
        "critical": "Сыни мәндер сақталды: ", "weakest": "Ең төмен аудан бағасы: ",
        "declines": "Көрсеткіштер төмендеді: ",
        "recommend_critical": "Келесі шараларды таңдағанда қалған сыни жұптар үшін каталогты қараңыз: {pairs}. Жаңа жиынтықтың әсерін бөлек есептеу қажет.",
        "recommend_weakest": "Келесі шараларды таңдағанда бағасы ең төмен ауданға назар аударыңыз: {districts}. Балама нұсқаның әсерін бөлек есептеу қажет.",
        "warning": "AI қолжетімсіз: үлгілік түсіндірме көрсетілді",
    },
    "en": {
        "summary": "Model score: {after} (baseline {before}); the result is {comparison}. This is a model result, not a forecast for the real city.",
        "higher": "{delta} above baseline", "lower": "{delta} below baseline", "equal": "equal to baseline",
        "districts": "District scores increased: ", "indicators": "Indicators improved: ",
        "resolved": "Pairs no longer below the critical threshold: ", "synergies": "Applied synergies: ",
        "synergy": "{first} + {second} in {district} ({indicator}: +{bonus} before clipping)",
        "unchanged": "The selected measures were evaluated; the report shows no higher district scores or resolved critical pairs.",
        "critical": "Critical values remain: ", "weakest": "Lowest district score: ",
        "declines": "Indicators decreased: ",
        "recommend_critical": "For the next selection, review catalog measures for the remaining critical pairs: {pairs}. A new selection requires a separate calculation.",
        "recommend_weakest": "For the next selection, consider the district with the lowest score: {districts}. An alternative requires a separate calculation.",
        "warning": "AI is unavailable: a template explanation is shown",
    },
}

DISTRICT_NAMES = {
    "ru": {"yesil": "Есиль", "almaty": "Алматы", "saryarka": "Сарыарка", "baikonur": "Байконур", "nura": "Нура"},
    "kk": {"yesil": "Есіл", "almaty": "Алматы", "saryarka": "Сарыарқа", "baikonur": "Байқоңыр", "nura": "Нұра"},
    "en": {"yesil": "Yesil", "almaty": "Almaty", "saryarka": "Saryarka", "baikonur": "Baikonur", "nura": "Nura"},
}


def number(value: float) -> str:
    """Round presentation only; the numeric report retains full precision."""
    return f"{value:.2f}".rstrip("0").rstrip(".")


def template_explanation(facts: ExplanationFacts) -> ExplanationSchema:
    report = facts.report
    text = TEXT[facts.language]
    names = DISTRICT_NAMES[facts.language]
    comparison = text[
        "higher" if report.score_delta > 0 else "lower" if report.score_delta < 0 else "equal"
    ].format(delta=number(abs(report.score_delta)))
    summary = text["summary"].format(
        after=number(report.after.score), before=number(report.baseline.score), comparison=comparison,
    )

    strengths = []
    before_by_id = {district.id: district for district in report.baseline.districts}
    improved = [district for district in report.after.districts
                if district.district_score > before_by_id[district.id].district_score]
    if improved:
        strengths.append(text["districts"] + ", ".join(
            f"{names[district.id]} ({number(before_by_id[district.id].district_score)} → {number(district.district_score)})"
            for district in improved
        ) + ".")
    improved_indicators = [change for change in report.indicator_changes if change.delta > 0]
    if improved_indicators:
        strengths.append(text["indicators"] + ", ".join(
            f"{names[change.district_id]} — {change.indicator} ({number(change.before)} → {number(change.after)})"
            for change in improved_indicators
        ) + ".")
    resolved = facts.context["resolved_critical_pairs"]
    if resolved:
        strengths.append(text["resolved"] + ", ".join(
            f"{names[pair['district_id']]} — {pair['indicator']}" for pair in resolved
        ) + ".")
    if report.synergy_effects:
        strengths.append(text["synergies"] + ", ".join(
            text["synergy"].format(
                first=effect.first_measure_id, second=effect.second_measure_id,
                district=names[effect.district_id], indicator=effect.indicator, bonus=number(effect.bonus),
            ) for effect in report.synergy_effects
        ) + ".")
    if not strengths:
        strengths.append(text["unchanged"])

    risks = []
    if report.after.critical_pairs:
        risks.append(text["critical"] + ", ".join(
            f"{names[pair.district_id]} — {pair.indicator} ({number(pair.value)})"
            for pair in report.after.critical_pairs
        ) + ".")
    if report.after.weakest_district_ids:
        risks.append(text["weakest"] + ", ".join(
            names[district_id] for district_id in report.after.weakest_district_ids
        ) + f" ({number(report.after.minimum)}).")
    declines = [change for change in report.indicator_changes if change.delta < 0]
    if declines:
        risks.append(text["declines"] + ", ".join(
            f"{names[change.district_id]} — {change.indicator} ({number(change.before)} → {number(change.after)})"
            for change in declines
        ) + ".")

    if report.after.critical_pairs:
        recommendation = text["recommend_critical"].format(pairs=", ".join(
            f"{names[pair.district_id]} — {pair.indicator}" for pair in report.after.critical_pairs
        ))
    else:
        recommendation = text["recommend_weakest"].format(districts=", ".join(
            names[district_id] for district_id in report.after.weakest_district_ids
        ))
    return ExplanationSchema(
        summary=summary, strengths=strengths, risks=risks, recommendations=[recommendation],
    )


def fallback_response(facts: ExplanationFacts, reason: ExplanationFailureReason) -> ExplainResponse:
    return ExplainResponse(
        model_version=facts.report.model_version,
        scenario_key=facts.report.scenario_key,
        language=facts.language,
        mode="fallback",
        llm_model=None,
        explanation=template_explanation(facts),
        warning=WarningSchema(code=reason.value, message=TEXT[facts.language]["warning"]),
    )
