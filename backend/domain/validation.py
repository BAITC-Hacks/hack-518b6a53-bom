"""Validate draft and final Tech2 scenarios without calculating a score."""

from collections import Counter, defaultdict

from backend.domain.models import Budget, Dataset, Selection, ValidationError, ValidationResult


def validate_scenario(
    dataset: Dataset, selections: tuple[Selection, ...], *, final: bool
) -> ValidationResult:
    """Check all rules that can be determined from the supplied selections.

    An unknown measure makes the total cost unavailable. Every known selection,
    including a duplicate, contributes its cost exactly once otherwise.
    """
    rules = dataset.rules
    errors: list[ValidationError] = []
    by_measure: dict[str, list[Selection]] = defaultdict(list)
    directions: Counter[str] = Counter()
    spent = 0
    unknown_measure = False
    seen_measures: set[str] = set()

    # Check IDs independently: even an unknown measure can carry a bad district.
    for index, selection in enumerate(selections):
        measure_id = selection.measure_id
        district_id = selection.district_id
        measure = dataset.measures.get(measure_id)
        if measure is None:
            unknown_measure = True
            errors.append(ValidationError(
                "UNKNOWN_MEASURE", f"Неизвестное мероприятие: {measure_id}",
                f"selections[{index}].measure_id",
            ))
        else:
            spent += measure.cost
            directions[measure.direction] += 1
            by_measure[measure_id].append(selection)

        if district_id is not None and district_id not in dataset.districts:
            errors.append(ValidationError(
                "UNKNOWN_DISTRICT", f"Неизвестный район: {district_id}",
                f"selections[{index}].district_id",
            ))

        if measure is not None:
            if measure.scope == "district" and district_id is None:
                errors.append(ValidationError(
                    "DISTRICT_REQUIRED", f"Для мероприятия {measure_id} нужен район",
                    f"selections[{index}].district_id",
                ))
            elif measure.scope == "city" and district_id is not None:
                errors.append(ValidationError(
                    "DISTRICT_FORBIDDEN", f"Для городского мероприятия {measure_id} район не указывается",
                    f"selections[{index}].district_id",
                ))

    count = len(selections)
    if count > rules.required_decisions or (final and count != rules.required_decisions):
        requirement = "ровно" if final else "не более"
        errors.append(ValidationError(
            "DECISION_COUNT", f"Требуется {requirement} {rules.required_decisions} решений; указано {count}",
            "selections",
        ))

    for index, selection in enumerate(selections):
        if selection.measure_id in seen_measures:
            errors.append(ValidationError(
                "DUPLICATE_MEASURE", f"Мероприятие {selection.measure_id} выбрано повторно",
                f"selections[{index}].measure_id",
            ))
        seen_measures.add(selection.measure_id)

    budget = Budget(
        limit=rules.budget_limit,
        spent=None if unknown_measure else spent,
        remaining=None if unknown_measure else rules.budget_limit - spent,
    )
    if spent > rules.budget_limit:
        cost_message = (f"Известные мероприятия стоят не менее {spent}"
                        if unknown_measure else f"Стоимость {spent}")
        errors.append(ValidationError(
            "BUDGET_EXCEEDED", f"{cost_message} при бюджете {rules.budget_limit}",
            "selections",
        ))

    for direction, quantity in directions.items():
        if quantity > rules.max_per_direction:
            errors.append(ValidationError(
                "DIRECTION_LIMIT",
                f"Направление {direction}: {quantity} мероприятий при лимите {rules.max_per_direction}",
                "selections",
            ))

    for conflict in rules.conflicts:
        first = by_measure.get(conflict.first_measure_id, ())
        second = by_measure.get(conflict.second_measure_id, ())
        if not first or not second:
            continue
        if conflict.scope == "global":
            errors.append(ValidationError(
                "INCOMPATIBLE_MEASURES",
                f"Мероприятия {conflict.first_measure_id} и {conflict.second_measure_id} несовместимы",
                "selections",
            ))
        elif conflict.scope == "same_district":
            conflicting_districts = {
                selection.district_id for selection in first
                if selection.district_id in dataset.districts
            } & {
                selection.district_id for selection in second
                if selection.district_id in dataset.districts
            }
            for district_id in sorted(conflicting_districts):
                errors.append(ValidationError(
                    "DISTRICT_CONFLICT",
                    f"Мероприятия {conflict.first_measure_id} и {conflict.second_measure_id} несовместимы в районе {district_id}",
                    "selections",
                ))

    valid_draft = (count <= rules.required_decisions
                   and all(error.code == "DECISION_COUNT" for error in errors))
    can_evaluate = valid_draft and count == rules.required_decisions
    return ValidationResult(valid_draft, can_evaluate, budget, tuple(errors))
