"""Load one complete, versioned Tech2 dataset from JSON files."""

import json
import math
from pathlib import Path
from typing import Any

from backend.domain.models import (
    Conflict,
    Dataset,
    District,
    Measure,
    Preset,
    Rules,
    Selection,
    Synergy,
)


INDICATORS = frozenset(("T1", "T2", "E1", "E2", "S1", "S2", "B1", "B2", "C1", "C2"))
DISTRICT_IDS = frozenset(("yesil", "almaty", "saryarka", "baikonur", "nura"))
MEASURE_IDS = frozenset(f"M{number}" for number in range(1, 15))
DIRECTIONS = frozenset(("transport", "ecology", "social", "safety", "services"))


def _fail(file: str, place: str, reason: str) -> None:
    raise ValueError(f"{file}: {place}: {reason}")


def _unique_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key {key!r}")
        result[key] = value
    return result


def _read(path: Path, section: str) -> dict[str, Any]:
    try:
        with path.open(encoding="utf-8") as source:
            value = json.load(source, object_pairs_hook=_unique_keys,
                              parse_constant=lambda value: _fail(path.name, "$", f"non-finite number {value}"))
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        if isinstance(exc, ValueError) and str(exc).startswith(f"{path.name}:"):
            raise
        raise ValueError(f"{path.name}: cannot read valid JSON: {exc}") from exc
    if section == "rules":
        fields = {
            "model_version", "budget_limit", "required_decisions", "max_per_direction",
            "horizon_quarters", "critical_threshold", "critical_penalty",
            "average_weight", "minimum_weight", "indicator_weights", "conflicts", "synergies",
        }
    else:
        fields = {"model_version", section}
    _object(value, path.name, "$", fields)
    return value


def _object(value: Any, file: str, place: str, fields: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict):
        _fail(file, place, "expected an object")
    missing, extra = fields - value.keys(), value.keys() - fields
    if missing or extra:
        _fail(file, place, f"fields differ: missing {sorted(missing)}, unexpected {sorted(extra)}")
    return value


def _list(value: Any, file: str, place: str) -> list[Any]:
    if not isinstance(value, list):
        _fail(file, place, "expected an array")
    return value


def _string(value: Any, file: str, place: str) -> str:
    if not isinstance(value, str) or not value.strip():
        _fail(file, place, "expected a nonempty string")
    return value


def _number(value: Any, file: str, place: str, low: float, high: float | None = None) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        _fail(file, place, "expected a finite number")
    try:
        numeric = float(value)
    except OverflowError:
        _fail(file, place, "expected a finite number")
    if not math.isfinite(numeric):
        _fail(file, place, "expected a finite number")
    if value < low or (high is not None and value > high):
        _fail(file, place, f"must be in [{low}, {high if high is not None else '∞'}]")
    return numeric


def _integer(value: Any, file: str, place: str, low: int, high: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        _fail(file, place, "expected an integer")
    _number(value, file, place, low, high)
    return value


def _indicator_map(value: Any, file: str, place: str, low: float, high: float) -> dict[str, float]:
    _object(value, file, place, set(INDICATORS))
    return {key: _number(item, file, f"{place}.{key}", low, high) for key, item in value.items()}


def _effects(value: Any, file: str, place: str) -> dict[str, float]:
    if not isinstance(value, dict) or not value:
        _fail(file, place, "expected a nonempty effects object")
    if set(value) - INDICATORS:
        _fail(file, place, f"unknown indicators: {sorted(set(value) - INDICATORS)}")
    return {key: _number(item, file, f"{place}.{key}", -100, 100) for key, item in value.items()}


def _ids(actual: set[str], expected: frozenset[str], file: str, place: str) -> None:
    if actual != expected:
        _fail(file, place, f"ID set differs: missing {sorted(expected - actual)}, unexpected {sorted(actual - expected)}")


def _districts(raw: dict[str, Any]) -> dict[str, District]:
    file = "districts.json"
    result = {}
    for index, item in enumerate(_list(raw["districts"], file, "districts")):
        place = f"districts[{index}]"
        _object(item, file, place, {"id", "name", "population_share", "indicators"})
        identifier = _string(item["id"], file, f"{place}.id")
        if identifier in result:
            _fail(file, place, f"duplicate district ID {identifier}")
        result[identifier] = District(
            identifier, _string(item["name"], file, f"{place}.name"),
            _number(item["population_share"], file, f"{place}.population_share", 0, 1),
            _indicator_map(item["indicators"], file, f"{place}.indicators", 0, 100),
        )
    _ids(set(result), DISTRICT_IDS, file, "districts")
    if not math.isclose(math.fsum(d.population_share for d in result.values()), 1, rel_tol=0, abs_tol=1e-8):
        _fail(file, "districts", "population shares must sum to 1")
    return result


def _measures(raw: dict[str, Any], horizon: int) -> dict[str, Measure]:
    file = "measures.json"
    result = {}
    for index, item in enumerate(_list(raw["measures"], file, "measures")):
        place = f"measures[{index}]"
        _object(item, file, place, {"id", "title", "direction", "scope", "cost", "lag", "effects"})
        identifier = _string(item["id"], file, f"{place}.id")
        if identifier in result:
            _fail(file, place, f"duplicate measure ID {identifier}")
        direction = _string(item["direction"], file, f"{place}.direction")
        scope = _string(item["scope"], file, f"{place}.scope")
        if direction not in DIRECTIONS:
            _fail(file, place, f"unknown direction {direction!r}")
        if scope not in {"district", "city"}:
            _fail(file, place, f"unknown scope {scope!r}")
        result[identifier] = Measure(
            identifier, _string(item["title"], file, f"{place}.title"), direction, scope,
            _integer(item["cost"], file, f"{place}.cost", 1),
            _integer(item["lag"], file, f"{place}.lag", 0, horizon),
            _effects(item["effects"], file, f"{place}.effects"),
        )
    _ids(set(result), MEASURE_IDS, file, "measures")
    return result


def _rules(raw: dict[str, Any], measures: dict[str, Measure]) -> Rules:
    file = "rules.json"
    horizon = _integer(raw["horizon_quarters"], file, "horizon_quarters", 1)
    weights = _indicator_map(raw["indicator_weights"], file, "indicator_weights", 0, 1)
    if not math.isclose(math.fsum(weights.values()), 1, rel_tol=0, abs_tol=1e-8):
        _fail(file, "indicator_weights", "weights must sum to 1")
    conflicts = []
    conflict_pairs: set[frozenset[str]] = set()
    for index, item in enumerate(_list(raw["conflicts"], file, "conflicts")):
        place = f"conflicts[{index}]"
        _object(item, file, place, {"first_measure_id", "second_measure_id", "scope"})
        first = _string(item["first_measure_id"], file, f"{place}.first_measure_id")
        second = _string(item["second_measure_id"], file, f"{place}.second_measure_id")
        scope = _string(item["scope"], file, f"{place}.scope")
        pair = frozenset((first, second))
        if first not in measures or second not in measures or first == second:
            _fail(file, place, "conflict must reference two distinct known measures")
        if pair in conflict_pairs:
            _fail(file, place, "duplicate conflict pair")
        if scope not in {"global", "same_district"}:
            _fail(file, place, f"unknown conflict scope {scope!r}")
        if scope == "same_district" and (measures[first].scope != "district" or measures[second].scope != "district"):
            _fail(file, place, "same_district conflict requires two district measures")
        conflict_pairs.add(pair)
        conflicts.append(Conflict(first, second, scope))
    synergies = []
    synergy_pairs: set[frozenset[str]] = set()
    for index, item in enumerate(_list(raw["synergies"], file, "synergies")):
        place = f"synergies[{index}]"
        _object(item, file, place, {"first_measure_id", "second_measure_id", "indicator", "bonus"})
        first = _string(item["first_measure_id"], file, f"{place}.first_measure_id")
        second = _string(item["second_measure_id"], file, f"{place}.second_measure_id")
        indicator = _string(item["indicator"], file, f"{place}.indicator")
        pair = frozenset((first, second))
        if first not in measures or second not in measures or first == second:
            _fail(file, place, "synergy must reference two distinct known measures")
        if measures[first].scope != "district":
            _fail(file, place, "first synergy measure must target a district")
        if indicator not in INDICATORS:
            _fail(file, place, f"unknown indicator {indicator!r}")
        if pair in synergy_pairs:
            _fail(file, place, "duplicate synergy pair")
        if pair in conflict_pairs and any(c.scope == "global" and frozenset((c.first_measure_id, c.second_measure_id)) == pair for c in conflicts):
            _fail(file, place, "synergy pair has a global conflict")
        synergy_pairs.add(pair)
        synergies.append(Synergy(first, second, indicator, _number(item["bonus"], file, f"{place}.bonus", 0, 100)))
    average_weight = _number(raw["average_weight"], file, "average_weight", 0, 1)
    minimum_weight = _number(raw["minimum_weight"], file, "minimum_weight", 0, 1)
    if not math.isclose(average_weight + minimum_weight, 1, rel_tol=0, abs_tol=1e-8):
        _fail(file, "average_weight/minimum_weight", "score weights must sum to 1")
    return Rules(
        _integer(raw["budget_limit"], file, "budget_limit", 1),
        _integer(raw["required_decisions"], file, "required_decisions", 1, len(measures)),
        _integer(raw["max_per_direction"], file, "max_per_direction", 1),
        horizon,
        _number(raw["critical_threshold"], file, "critical_threshold", 0, 100),
        _number(raw["critical_penalty"], file, "critical_penalty", 0),
        average_weight, minimum_weight, weights, tuple(synergies), tuple(conflicts),
    )


def _presets(raw: dict[str, Any], districts: dict[str, District], measures: dict[str, Measure], rules: Rules) -> tuple[Preset, ...]:
    file = "presets.json"
    result = []
    seen_ids = set()
    for index, item in enumerate(_list(raw["presets"], file, "presets")):
        place = f"presets[{index}]"
        _object(item, file, place, {"id", "title", "selections"})
        identifier = _string(item["id"], file, f"{place}.id")
        if identifier in seen_ids:
            _fail(file, place, f"duplicate preset ID {identifier}")
        seen_ids.add(identifier)
        selections = []
        selected_ids = set()
        directions: dict[str, int] = {}
        spent = 0
        for selection_index, selection in enumerate(_list(item["selections"], file, f"{place}.selections")):
            selection_place = f"{place}.selections[{selection_index}]"
            if not isinstance(selection, dict):
                _fail(file, selection_place, "expected an object")
            if set(selection) not in ({"measure_id"}, {"measure_id", "district_id"}):
                _fail(file, selection_place, "expected measure_id and optional district_id only")
            measure_id = _string(selection["measure_id"], file, f"{selection_place}.measure_id")
            if measure_id not in measures:
                _fail(file, selection_place, f"unknown measure {measure_id!r}")
            if measure_id in selected_ids:
                _fail(file, selection_place, f"duplicate measure {measure_id!r}")
            measure = measures[measure_id]
            district_id = selection.get("district_id")
            if measure.scope == "district":
                if not isinstance(district_id, str) or district_id not in districts:
                    _fail(file, selection_place, "district measure requires a known district_id")
            elif "district_id" in selection:
                _fail(file, selection_place, "city measure must omit district_id")
            selected_ids.add(measure_id)
            directions[measure.direction] = directions.get(measure.direction, 0) + 1
            spent += measure.cost
            selections.append(Selection(measure_id, district_id))
        if len(selections) != rules.required_decisions:
            _fail(file, place, f"expected {rules.required_decisions} selections")
        if spent > rules.budget_limit:
            _fail(file, place, "preset exceeds budget")
        if any(count > rules.max_per_direction for count in directions.values()):
            _fail(file, place, "preset exceeds direction limit")
        by_measure = {selection.measure_id: selection for selection in selections}
        for conflict in rules.conflicts:
            if conflict.first_measure_id in by_measure and conflict.second_measure_id in by_measure:
                if conflict.scope == "global" or by_measure[conflict.first_measure_id].district_id == by_measure[conflict.second_measure_id].district_id:
                    _fail(file, place, f"preset contains conflicting measures {conflict.first_measure_id} and {conflict.second_measure_id}")
        result.append(Preset(identifier, _string(item["title"], file, f"{place}.title"), tuple(selections)))
    return tuple(result)


def load_dataset(path: str | Path) -> Dataset:
    """Return immutable domain values, or raise ValueError with the source filename."""
    directory = Path(path)
    raw = {name: _read(directory / f"{name}.json", name) for name in ("districts", "measures", "rules", "presets")}
    versions = {}
    for name, contents in raw.items():
        version = _string(contents["model_version"], f"{name}.json", "model_version")
        versions[name] = version
    if len(set(versions.values())) != 1:
        detail = ", ".join(f"{name}.json={version!r}" for name, version in versions.items())
        _fail("rules.json", "model_version", f"dataset files have different versions ({detail})")
    if directory.name.startswith("tech2-") and versions["rules"] != directory.name:
        _fail("rules.json", "model_version", f"{versions['rules']!r} does not match directory {directory.name!r}")
    districts = _districts(raw["districts"])
    horizon = _integer(raw["rules"]["horizon_quarters"], "rules.json", "horizon_quarters", 1)
    measures = _measures(raw["measures"], horizon)
    rules = _rules(raw["rules"], measures)
    presets = _presets(raw["presets"], districts, measures, rules)
    return Dataset(versions["rules"], districts, measures, rules, presets)
