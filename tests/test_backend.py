"""Reproducible backend checks; no external network or extra test dependencies."""

import asyncio
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from pydantic import ValidationError

from backend.adapters.dataset import load_dataset
from backend.adapters.llm import BriefExplanation, OpenAIExplanationAdapter
from backend.domain.models import Selection
from backend.domain.simulation import simulate
from backend.main import app
from backend.services.explanations import (
    ExplanationFacts, ExplanationFailure, ExplanationFailureReason, ExplanationService,
    ExplanationSuccess, build_ai_context,
)
from backend.services.scenarios import InvalidScenario, ScenarioService
from backend.settings import Settings
from shared.schemas import ExplainRequest, ExplanationSchema, ScenarioRequest


DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "tech2-v1"


def scenarios() -> ScenarioService:
    dataset = load_dataset(DATA_DIR)
    return ScenarioService(dataset, simulate(dataset, ()))


def request_payload(service: ScenarioService) -> dict:
    return {
        "model_version": service.dataset.model_version,
        "selections": [
            {"measure_id": item.measure_id, **(
                {"district_id": item.district_id} if item.district_id is not None else {}
            )}
            for item in service.dataset.presets[0].selections
        ],
    }


def provider_response(summary: str = "A calculated explanation") -> SimpleNamespace:
    return SimpleNamespace(
        status="completed", output=[], model="test-response-model",
        output_parsed=BriefExplanation(summary=summary),
    )


class NumericRegressionTests(unittest.TestCase):
    def setUp(self):
        self.service = scenarios()

    def test_baseline_and_both_authoritative_presets(self):
        baseline = self.service.baseline.after
        self.assertAlmostEqual(baseline.average, 56.8624)
        self.assertAlmostEqual(baseline.minimum, 49.18)
        self.assertAlmostEqual(baseline.score, 52.55768)
        self.assertEqual(len(baseline.critical_pairs), 2)
        for preset, expected_score, expected_spent in zip(
            self.service.dataset.presets, (56.54307, 55.343025), (95, 61),
        ):
            with self.subTest(preset=preset.id):
                report = self.service.evaluate(self.service.dataset.model_version, preset.selections)
                self.assertAlmostEqual(report.after.score, expected_score)
                self.assertEqual(report.budget.spent, expected_spent)
                reversed_report = self.service.evaluate(
                    self.service.dataset.model_version, tuple(reversed(preset.selections)),
                )
                self.assertEqual(report, reversed_report)

    def test_valid_draft_cannot_be_evaluated_early(self):
        selections = self.service.dataset.presets[0].selections[:2]
        validation = self.service.validate_draft(self.service.dataset.model_version, selections)
        self.assertTrue(validation.valid_draft)
        self.assertFalse(validation.can_evaluate)
        with self.assertRaises(InvalidScenario):
            self.service.evaluate(self.service.dataset.model_version, selections)

    def test_rule_failures_keep_cost_and_reject_city_target(self):
        selections = (Selection("M12", "nura"), Selection("M12"))
        result = self.service.validate_draft(self.service.dataset.model_version, selections)
        self.assertEqual(result.budget.spent, 28)
        self.assertEqual({error.code for error in result.errors}, {
            "DISTRICT_FORBIDDEN", "DUPLICATE_MEASURE",
        })


class CompactContextTests(unittest.TestCase):
    def setUp(self):
        self.service = scenarios()
        self.report = self.service.evaluate(
            self.service.dataset.model_version, self.service.dataset.presets[0].selections,
        )

    def test_city_context_contains_aggregates_without_full_indicator_matrix(self):
        context = build_ai_context(self.report, self.service.dataset)
        self.assertIsNone(context["scope"]["district_id"])
        self.assertEqual(len(context["districts"]), 5)
        self.assertIn("average", context["after"])
        self.assertIn("minimum", context["after"])
        self.assertEqual(len(context["top_changes"]), 4)
        self.assertEqual(len(context["weak_spots"]), 3)
        self.assertNotIn("indicators", context)
        self.assertNotIn("indicator_changes_after_clip", context)
        self.assertLess(len(json.dumps(context, ensure_ascii=False)), 7000)
        self.assertEqual(context["after"]["score"], 56.54)
        self.assertAlmostEqual(self.report.after.score, 56.54307)

    def test_district_context_filters_indicators_synergies_and_current_decisions(self):
        context = build_ai_context(self.report, self.service.dataset, "nura")
        nura = next(district for district in self.report.after.districts if district.id == "nura")
        self.assertEqual(context["scope"]["district_id"], "nura")
        self.assertEqual(context["after"]["score"], round(nura.district_score, 2))
        self.assertEqual(len(context["indicators"]), 10)
        self.assertNotIn("districts", context)
        self.assertNotIn("average", context["after"])
        for field in ("indicators", "top_changes", "weak_spots", "synergies"):
            self.assertTrue(all(item["district_id"] == "nura" for item in context[field]))
        self.assertEqual({item["id"] for item in context["decisions"]}, {"M7", "M8", "M10", "M12"})
        self.assertEqual(len(context["recommendation_catalog"]), 14)
        self.assertLess(len(json.dumps(context, ensure_ascii=False)), 7000)

    def test_city_context_keeps_every_nonzero_delta_including_city_measure(self):
        context = build_ai_context(self.report, self.service.dataset)
        expected = {
            (change.district_id, change.indicator): change.delta
            for change in self.report.indicator_changes if change.delta != 0
        }
        actual = {
            (district_id, indicator): delta
            for district_id, indicators in context["indicator_deltas"].items()
            for indicator, delta in indicators.items()
        }
        self.assertEqual(actual, expected)
        for district_id in self.service.dataset.districts:
            self.assertEqual(actual[(district_id, "C2")], 4.375)
        effects = {item["measure_id"]: item for item in context["measure_effects"]}
        self.assertEqual(set(effects), {selection.measure_id for selection in self.report.selections})
        self.assertEqual(effects["M12"]["cost"], 14)
        self.assertEqual(effects["M12"]["realized_fraction"], 0.875)
        self.assertEqual(effects["M12"]["additions"], {
            district_id: {"C2": 4.375} for district_id in self.service.dataset.districts
        })

    def test_all_precomputed_measure_contributions_and_district_deltas_are_forwarded(self):
        context = build_ai_context(self.report, self.service.dataset)
        for supplied, calculated in zip(context["measure_effects"], self.report.measure_effects):
            self.assertEqual(supplied, {
                "measure_id": calculated.measure_id, "district_id": calculated.district_id,
                "cost": calculated.cost, "lag": calculated.lag,
                "realized_fraction": calculated.realized_fraction,
                "additions": {target: dict(values) for target, values in calculated.additions.items()},
            })
        before = {district.id: district.district_score for district in self.report.baseline.districts}
        after = {district.id: district.district_score for district in self.report.after.districts}
        self.assertEqual({district["id"]: district["delta"] for district in context["districts"]}, {
            identifier: score - before[identifier] for identifier, score in after.items()
        })

    def test_negative_measure_effect_remains_visible_to_ai(self):
        report = self.service.evaluate(
            self.service.dataset.model_version, self.service.dataset.presets[1].selections,
        )
        context = build_ai_context(report, self.service.dataset)
        m11 = next(item for item in context["measure_effects"] if item["measure_id"] == "M11")
        self.assertEqual(m11["realized_fraction"], 0.875)
        self.assertEqual(m11["additions"], {"nura": {"B2": 10.5, "T1": -1.75}})
        self.assertEqual(context["indicator_deltas"]["nura"]["T1"], -1.75)

    def test_district_filters_ready_measure_effects_and_city_additions(self):
        context = build_ai_context(self.report, self.service.dataset, "nura")
        self.assertEqual(set(context["indicator_deltas"]), {"nura"})
        self.assertEqual(context["indicator_deltas"]["nura"]["C2"], 4.375)
        self.assertEqual({effect["measure_id"] for effect in context["measure_effects"]}, {
            "M7", "M8", "M10", "M12",
        })
        for effect in context["measure_effects"]:
            self.assertEqual(set(effect["additions"]), {"nura"})
        m12 = next(effect for effect in context["measure_effects"] if effect["measure_id"] == "M12")
        self.assertIsNone(m12["district_id"])
        self.assertEqual(m12["additions"], {"nura": {"C2": 4.375}})


class SchemaTests(unittest.TestCase):
    def setUp(self):
        self.payload = request_payload(scenarios())

    def test_language_is_optional_only_for_explain(self):
        self.assertEqual(ExplainRequest.model_validate(self.payload).language, "ru")
        for language in ("ru", "kk", "en"):
            payload = {**self.payload, "language": language}
            self.assertEqual(ExplainRequest.model_validate(payload).language, language)
            with self.assertRaises(ValidationError):
                ScenarioRequest.model_validate(payload)

    def test_rejects_unsupported_language_extra_fields_and_null_district(self):
        for extra in ({"language": "de"}, {"language": None}, {"prompt": "override"}):
            with self.subTest(extra=extra), self.assertRaises(ValidationError):
                ExplainRequest.model_validate({**self.payload, **extra})
        with self.assertRaises(ValidationError):
            ExplainRequest.model_validate({
                **self.payload, "selections": [{"measure_id": "M12", "district_id": None}],
            })
        with self.assertRaises(ValidationError):
            ExplainRequest.model_validate({**self.payload, "district_id": None})

    def test_explanation_scope_is_separate_from_numerical_request(self):
        scoped = {**self.payload, "district_id": "nura"}
        self.assertEqual(ExplainRequest.model_validate(scoped).district_id, "nura")
        self.assertIsNone(ExplainRequest.model_validate(self.payload).district_id)
        with self.assertRaises(ValidationError):
            ScenarioRequest.model_validate(scoped)

    def test_cleans_forbidden_character_in_every_explanation_field(self):
        value = "left" + chr(183) + "right"
        explanation = ExplanationSchema(
            summary=value, strengths=[value], risks=[value], recommendations=[value],
        )
        self.assertNotIn(chr(183), json.dumps(explanation.model_dump(), ensure_ascii=False))
        self.assertEqual(explanation.summary, "left right")


class BackendHTTPTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.environment = patch.dict(os.environ, {
            "DATA_DIR": str(DATA_DIR), "OPENAI_API_KEY": "", "OPENAI_MODEL": "",
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.lifespan = app.router.lifespan_context(app)
        await self.lifespan.__aenter__()
        self.addAsyncCleanup(self.lifespan.__aexit__, None, None, None)
        self.payload = request_payload(app.state.scenario_service)

    async def request(
        self, method: str, path: str, payload: dict | None = None,
        disconnect: asyncio.Event | None = None,
    ):
        body = json.dumps(payload).encode() if payload is not None else b""
        messages = []
        received = False
        disconnected = disconnect if disconnect is not None else asyncio.Event()
        final_body_received = False

        async def receive():
            nonlocal received, final_body_received
            if received:
                if not final_body_received:
                    final_body_received = True
                    return {"type": "http.request", "body": b"", "more_body": False}
                await disconnected.wait()
                return {"type": "http.disconnect"}
            received = True
            return {"type": "http.request", "body": body, "more_body": False}

        async def send(message):
            messages.append(message)

        await app({
            "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
            "method": method, "scheme": "http", "path": path, "raw_path": path.encode(),
            "query_string": b"", "root_path": "",
            "headers": [(b"content-type", b"application/json")],
            "server": ("testserver", 80), "client": ("testclient", 1234),
        }, receive, send)
        status = next(message["status"] for message in messages if message["type"] == "http.response.start")
        result = b"".join(message.get("body", b"") for message in messages if message["type"] == "http.response.body")
        return status, json.loads(result)

    async def test_localized_fallback_at_http_boundary(self):
        expected = {
            "ru": ("Оценка модели:", "AI недоступен:"),
            "kk": ("Модель бағасы:", "AI қолжетімсіз:"),
            "en": ("Model score:", "AI is unavailable:"),
        }
        keys = set()
        for language, (summary, warning) in expected.items():
            with self.subTest(language=language):
                status, result = await self.request("POST", "/api/v1/explain", {
                    **self.payload, "language": language,
                })
                self.assertEqual(status, 200)
                self.assertEqual(result["language"], language)
                self.assertIsNone(result["district_id"])
                self.assertEqual(result["mode"], "fallback")
                self.assertIsNone(result["llm_model"])
                self.assertEqual(result["warning"]["code"], "AI_NOT_CONFIGURED")
                self.assertTrue(result["warning"]["message"].startswith(warning))
                self.assertTrue(result["explanation"]["summary"].startswith(summary))
                self.assertNotIn(chr(183), json.dumps(result, ensure_ascii=False))
                keys.add(result["scenario_key"])
        self.assertEqual(len(keys), 1)
        status, result = await self.request("POST", "/api/v1/explain", self.payload)
        self.assertEqual((status, result["language"]), (200, "ru"))

    async def test_numeric_routes_remain_strict_and_unchanged(self):
        for path in ("/api/v1/validate", "/api/v1/evaluate"):
            status, result = await self.request("POST", path, {**self.payload, "language": "en"})
            self.assertEqual(status, 422)
            self.assertEqual(result["errors"][0]["path"], "language")
        status, result = await self.request("POST", "/api/v1/evaluate", self.payload)
        self.assertEqual(status, 200)
        self.assertAlmostEqual(result["after"]["score"], 56.54307)
        self.assertNotIn("language", result)

    async def test_unsupported_language_rejected_before_adapter(self):
        adapter = SimpleNamespace(explain=AsyncMock())
        app.state.explanation_service = ExplanationService(app.state.scenario_service, adapter)
        status, result = await self.request("POST", "/api/v1/explain", {**self.payload, "language": "de"})
        self.assertEqual(status, 422)
        self.assertEqual(result["errors"][0]["path"], "language")
        adapter.explain.assert_not_awaited()

    async def test_language_reaches_adapter_and_is_echoed_with_success(self):
        adapter = SimpleNamespace(explain=AsyncMock(return_value=ExplanationSuccess(
            ExplanationSchema(summary="Қала көрсеткіштері өсті", strengths=[], risks=[], recommendations=[]), "test-model",
        )))
        app.state.explanation_service = ExplanationService(app.state.scenario_service, adapter)
        status, result = await self.request("POST", "/api/v1/explain", {**self.payload, "language": "kk"})
        self.assertEqual((status, result["language"], result["mode"]), (200, "kk", "llm"))
        facts = adapter.explain.await_args.args[0]
        self.assertEqual(facts.language, "kk")
        self.assertEqual(facts.context["after"]["score"], 56.54)
        self.assertAlmostEqual(facts.report.after.score, 56.54307)
        self.assertEqual(result["scenario_key"], facts.report.scenario_key)

    async def test_unknown_district_rejected_before_provider(self):
        adapter = SimpleNamespace(explain=AsyncMock())
        app.state.explanation_service = ExplanationService(app.state.scenario_service, adapter)
        status, result = await self.request("POST", "/api/v1/explain", {
            **self.payload, "district_id": "unknown-district",
        })
        self.assertEqual(status, 422)
        self.assertEqual(result["errors"][0]["code"], "UNKNOWN_DISTRICT")
        self.assertEqual(result["errors"][0]["path"], "district_id")
        adapter.explain.assert_not_awaited()

    async def test_every_district_has_its_own_compact_localized_fallback(self):
        for district_id in app.state.scenario_service.dataset.districts:
            with self.subTest(district=district_id):
                status, result = await self.request("POST", "/api/v1/explain", {
                    **self.payload, "language": "en", "district_id": district_id,
                })
                self.assertEqual((status, result["district_id"], result["language"]), (200, district_id, "en"))
                self.assertEqual(result["mode"], "fallback")
                self.assertNotIn("\n", result["explanation"]["summary"])
                for field in ("strengths", "risks", "recommendations"):
                    self.assertEqual(result["explanation"][field], [])
                if district_id == "nura":
                    self.assertIn("Nura", result["explanation"]["summary"])
                    self.assertNotIn("Saryarka", result["explanation"]["summary"])

    async def test_scoped_success_echoes_scope_and_forwards_only_relevant_measures(self):
        adapter = SimpleNamespace(explain=AsyncMock(return_value=ExplanationSuccess(
            ExplanationSchema(summary="Nura analysis", strengths=[], risks=[], recommendations=[]), "test-model",
        )))
        app.state.explanation_service = ExplanationService(app.state.scenario_service, adapter)
        status, result = await self.request("POST", "/api/v1/explain", {
            **self.payload, "language": "en", "district_id": "nura",
        })
        self.assertEqual((status, result["district_id"], result["mode"]), (200, "nura", "llm"))
        facts = adapter.explain.await_args.args[0]
        self.assertEqual(facts.district_id, "nura")
        self.assertEqual({item["id"] for item in facts.context["decisions"]}, {"M7", "M8", "M10", "M12"})

    async def test_untouched_district_fallback_does_not_claim_a_change(self):
        selections = [
            {"measure_id": "M11", "district_id": "nura"} if item["measure_id"] == "M12" else item
            for item in self.payload["selections"]
        ]
        status, result = await self.request("POST", "/api/v1/explain", {
            **self.payload, "selections": selections, "language": "en", "district_id": "yesil",
        })
        self.assertEqual(status, 200)
        self.assertIn("Yesil: the indicators did not change", result["explanation"]["summary"])

    async def test_ai_unconfigured_does_not_block_catalog_or_readiness(self):
        status, result = await self.request("GET", "/health/ready")
        self.assertEqual((status, result["status"]), (200, "ready"))
        status, result = await self.request("GET", "/health/ai")
        self.assertEqual(status, 503)
        self.assertFalse(result["configured"])
        status, result = await self.request("GET", "/api/v1/catalog")
        self.assertEqual(status, 200)
        self.assertEqual(len(result["districts"]), 5)
        self.assertEqual(len(result["measures"]), 14)

    async def test_consumed_body_does_not_cancel_slow_explanation(self):
        entered, release = asyncio.Event(), asyncio.Event()

        async def parse(**kwargs):
            entered.set()
            await release.wait()
            return provider_response()

        adapter = OpenAIExplanationAdapter(
            Settings(DATA_DIR, "INFO", "test-key", "test-model", 45, 2000),
            SimpleNamespace(responses=SimpleNamespace(parse=parse)),
        )
        app.state.explanation_service = ExplanationService(app.state.scenario_service, adapter)
        pending = asyncio.create_task(self.request("POST", "/api/v1/explain", {
            **self.payload, "language": "en",
        }))
        try:
            await asyncio.wait_for(entered.wait(), timeout=1)
            await asyncio.sleep(0)
            self.assertFalse(pending.done())
        finally:
            release.set()
            status, result = await asyncio.wait_for(pending, timeout=1)
        self.assertEqual((status, result["mode"], result["language"]), (200, "llm", "en"))

    async def test_disconnect_cancels_provider_and_releases_slot(self):
        entered, cancelled, disconnected = asyncio.Event(), asyncio.Event(), asyncio.Event()

        async def slow_parse(**kwargs):
            entered.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                cancelled.set()
                raise

        parse = AsyncMock(side_effect=slow_parse)
        adapter = OpenAIExplanationAdapter(
            Settings(DATA_DIR, "INFO", "test-key", "test-model", 45, 2000),
            SimpleNamespace(responses=SimpleNamespace(parse=parse)),
        )
        app.state.explanation_service = ExplanationService(app.state.scenario_service, adapter)
        pending = asyncio.create_task(self.request(
            "POST", "/api/v1/explain", self.payload, disconnect=disconnected,
        ))
        try:
            await asyncio.wait_for(entered.wait(), timeout=1)
        finally:
            disconnected.set()
            status, result = await asyncio.wait_for(pending, timeout=1)
        self.assertEqual((status, result["errors"][0]["code"]), (499, "CLIENT_DISCONNECTED"))
        self.assertTrue(cancelled.is_set())
        self.assertEqual(adapter.health().last_status, "not_checked")
        parse.side_effect = None
        parse.return_value = provider_response()
        status, result = await self.request("POST", "/api/v1/explain", {**self.payload, "language": "en"})
        self.assertEqual((status, result["mode"], result["language"]), (200, "llm", "en"))


class OpenAIAdapterTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.service = scenarios()
        report = self.service.evaluate(
            self.service.dataset.model_version, self.service.dataset.presets[0].selections,
        )
        self.context = build_ai_context(report, self.service.dataset)
        self.facts = ExplanationFacts(report, self.context, "en")
        self.settings = Settings(DATA_DIR, "INFO", "test-key", "test-model", 45, 2000)

    async def test_selected_language_controls_prompt_without_changing_facts(self):
        parse = AsyncMock(return_value=provider_response())
        adapter = OpenAIExplanationAdapter(self.settings, SimpleNamespace(responses=SimpleNamespace(parse=parse)))
        for language, name in (("ru", "Russian"), ("kk", "Kazakh"), ("en", "English")):
            facts = ExplanationFacts(self.facts.report, self.context, language)
            result = await adapter.explain(facts)
            self.assertIsInstance(result, ExplanationSuccess)
            arguments = parse.await_args.kwargs
            self.assertIn(f"in {name}", arguments["input"][0]["content"])
            self.assertNotIn("Отвечай по-русски", arguments["input"][0]["content"])
            self.assertEqual(json.loads(arguments["input"][1]["content"]), self.context)
            self.assertFalse(arguments["store"])
            self.assertEqual(arguments["model"], "test-model")

    async def test_luna_uses_compact_schema_no_reasoning_and_bounded_output(self):
        parse = AsyncMock(return_value=provider_response("First line\n\nSecond line"))
        adapter = OpenAIExplanationAdapter(
            Settings(DATA_DIR, "INFO", "test-key", "gpt-6-luna", 45, 2000),
            SimpleNamespace(responses=SimpleNamespace(parse=parse)),
        )
        result = await adapter.explain(self.facts)
        self.assertIsInstance(result, ExplanationSuccess)
        arguments = parse.await_args.kwargs
        self.assertEqual(arguments["model"], "gpt-6-luna")
        self.assertEqual(arguments["reasoning"], {"effort": "none"})
        self.assertEqual(arguments["max_output_tokens"], 900)
        self.assertEqual(set(arguments["text_format"].model_json_schema()["properties"]), {"summary"})
        self.assertEqual(result.explanation.summary, "First line Second line")
        self.assertEqual(result.explanation.strengths, [])
        self.assertEqual(result.explanation.risks, [])
        self.assertEqual(result.explanation.recommendations, [])

    async def test_smaller_configured_output_limit_is_respected(self):
        parse = AsyncMock(return_value=provider_response())
        adapter = OpenAIExplanationAdapter(
            Settings(DATA_DIR, "INFO", "test-key", "gpt-6-luna", 45, 600),
            SimpleNamespace(responses=SimpleNamespace(parse=parse)),
        )
        await adapter.explain(self.facts)
        self.assertEqual(parse.await_args.kwargs["max_output_tokens"], 600)

    async def test_busy_slot_returns_immediately_and_releases_after_completion(self):
        entered, release = asyncio.Event(), asyncio.Event()

        async def parse(**kwargs):
            entered.set()
            await release.wait()
            return provider_response()

        adapter = OpenAIExplanationAdapter(self.settings, SimpleNamespace(responses=SimpleNamespace(parse=parse)))
        first = asyncio.create_task(adapter.explain(self.facts))
        try:
            await asyncio.wait_for(entered.wait(), timeout=1)
            second = await asyncio.wait_for(adapter.explain(self.facts), timeout=1)
            self.assertEqual(second, ExplanationFailure(ExplanationFailureReason.AI_BUSY))
            self.assertEqual(adapter.health().last_status, "not_checked")
        finally:
            release.set()
            await first
        self.assertIsInstance(await adapter.explain(self.facts), ExplanationSuccess)
        self.assertEqual(adapter.health().last_status, "ok")

    async def test_timeout_and_empty_cleaned_response_become_typed_failures(self):
        parse = AsyncMock(side_effect=TimeoutError)
        adapter = OpenAIExplanationAdapter(self.settings, SimpleNamespace(responses=SimpleNamespace(parse=parse)))
        self.assertEqual(await adapter.explain(self.facts), ExplanationFailure(ExplanationFailureReason.AI_TIMEOUT))
        parse.side_effect = None
        parse.return_value = provider_response(chr(183))
        self.assertEqual(await adapter.explain(self.facts), ExplanationFailure(ExplanationFailureReason.AI_INVALID_RESPONSE))
        self.assertEqual(adapter.health().last_status, "error")


if __name__ == "__main__":
    unittest.main()
