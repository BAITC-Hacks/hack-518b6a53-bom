"""Compact localized fallback for the requested city or district scope."""

from backend.services.explanations import ExplanationFacts, ExplanationFailureReason
from shared.schemas import ExplainResponse, ExplanationSchema, WarningSchema


TEXT = {
    "ru": {
        "summary": "Оценка модели: {before} → {after}. {scope}: {change}. Самым слабым остаётся {weakest} со значением {value}. При следующем выборе обратите внимание на меры, которые улучшают этот показатель; учитывайте их лаг и совместимость с другими решениями. Эффект альтернативного набора нужно рассчитать отдельно. Это результат модели, а не прогноз для реального города.",
        "change": "наибольшее изменение у показателя {indicator}", "unchanged": "показатели не изменились",
        "warning": "AI недоступен: показано шаблонное объяснение", "city": "Астана",
    },
    "kk": {
        "summary": "Модель бағасы: {before} → {after}. {scope}: {change}. Ең әлсіз көрсеткіш — {weakest}, оның мәні {value}. Келесі таңдауда осы көрсеткішті жақсартатын шараларға назар аударыңыз; олардың әсер ету кідірісін және басқа шешімдермен үйлесімділігін ескеріңіз. Балама жиынтықтың әсерін бөлек есептеу қажет. Бұл нақты қаланың болжамы емес, модель нәтижесі.",
        "change": "ең үлкен өзгеріс {indicator} көрсеткішінде", "unchanged": "көрсеткіштер өзгерген жоқ",
        "warning": "AI қолжетімсіз: үлгілік түсіндірме көрсетілді", "city": "Астана",
    },
    "en": {
        "summary": "Model score: {before} → {after}. {scope}: {change}. The weakest indicator remains {weakest} at {value}. For the next selection, consider measures that address this gap, accounting for their delay and compatibility with other decisions. Evaluate an alternative selection separately before expecting an improvement. This is a model result, not a forecast for the real city.",
        "change": "the largest change concerns {indicator}", "unchanged": "the indicators did not change",
        "warning": "AI is unavailable: a template explanation is shown", "city": "Astana",
    },
}

DISTRICT_NAMES = {
    "ru": {"yesil": "Есиль", "almaty": "Алматы", "saryarka": "Сарыарка", "baikonur": "Байконур", "nura": "Нура"},
    "kk": {"yesil": "Есіл", "almaty": "Алматы", "saryarka": "Сарыарқа", "baikonur": "Байқоңыр", "nura": "Нұра"},
    "en": {"yesil": "Yesil", "almaty": "Almaty", "saryarka": "Saryarka", "baikonur": "Baikonur", "nura": "Nura"},
}


def number(value: float) -> str:
    return f"{value:.2f}".rstrip("0").rstrip(".")


def template_explanation(facts: ExplanationFacts) -> ExplanationSchema:
    text = TEXT[facts.language]
    context = facts.context
    names = DISTRICT_NAMES[facts.language]

    def indicator_label(change: dict) -> str:
        if facts.district_id is not None:
            return change["indicator"]
        return f"{names[change['district_id']]} / {change['indicator']}"

    weakest = context["weak_spots"][0]
    strongest = context["top_changes"][0]
    change = text["change"].format(indicator=indicator_label(strongest)) if strongest["delta"] else text["unchanged"]
    summary = text["summary"].format(
        before=number(context["before"]["score"]), after=number(context["after"]["score"]),
        scope=names[facts.district_id] if facts.district_id else text["city"],
        change=change, weakest=indicator_label(weakest),
        value=number(weakest["after"]),
    )
    return ExplanationSchema(summary=summary, strengths=[], risks=[], recommendations=[])


def fallback_response(facts: ExplanationFacts, reason: ExplanationFailureReason) -> ExplainResponse:
    return ExplainResponse(
        model_version=facts.report.model_version,
        scenario_key=facts.report.scenario_key,
        language=facts.language,
        district_id=facts.district_id,
        mode="fallback",
        llm_model=None,
        explanation=template_explanation(facts),
        warning=WarningSchema(code=reason.value, message=TEXT[facts.language]["warning"]),
    )
