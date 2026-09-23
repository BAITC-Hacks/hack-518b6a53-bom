"""One bounded, non-streaming OpenAI explanation request per process."""

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

from openai import APITimeoutError, AsyncOpenAI
from pydantic import ValidationError

from backend.services.explanations import (
    ExplanationFacts, ExplanationFailure, ExplanationFailureReason, ExplanationSuccess,
)
from backend.settings import Settings
from shared.schemas import AIHealthResponse, ExplanationSchema


LANGUAGE_INSTRUCTIONS = {
    "ru": "Write every explanation field in Russian. Use Russian district names.",
    "kk": "Write every explanation field in Kazakh. Use Kazakh district names.",
    "en": "Write every explanation field in English. Transliterate district names into English.",
}


class OpenAIExplanationAdapter:
    def __init__(self, settings: Settings, client: AsyncOpenAI | None) -> None:
        self.settings = settings
        self.client = client
        self._slot_lock = asyncio.Lock()
        self._occupied = False
        self._last_status = "not_checked"
        self._last_checked_at: str | None = None
        self._instructions = Path(__file__).resolve().parents[1].joinpath(
            "prompts", "explanation.txt"
        ).read_text(encoding="utf-8")

    def health(self) -> AIHealthResponse:
        return AIHealthResponse(
            configured=self.settings.ai_configured,
            model=self.settings.openai_model,
            last_status=self._last_status,
            last_checked_at=self._last_checked_at,
        )

    def _record(self, ok: bool) -> None:
        self._last_status = "ok" if ok else "error"
        self._last_checked_at = datetime.now(timezone.utc).isoformat()

    async def explain(self, facts: ExplanationFacts) -> ExplanationSuccess | ExplanationFailure:
        if not self.settings.ai_configured or self.client is None:
            return ExplanationFailure(ExplanationFailureReason.AI_NOT_CONFIGURED)

        # The lock guards only the check and assignment; it never guards the API call.
        async with self._slot_lock:
            if self._occupied:
                return ExplanationFailure(ExplanationFailureReason.AI_BUSY)
            self._occupied = True

        try:
            payload = json.dumps(facts.context, ensure_ascii=False)
            instructions = self._instructions + "\n\n" + LANGUAGE_INSTRUCTIONS[facts.language]
            try:
                response = await asyncio.wait_for(
                    self.client.responses.parse(
                        model=self.settings.openai_model,
                        input=[
                            {"role": "system", "content": instructions},
                            {"role": "user", "content": payload},
                        ],
                        text_format=ExplanationSchema,
                        max_output_tokens=self.settings.openai_max_output_tokens,
                        store=False,
                    ),
                    timeout=self.settings.openai_timeout_seconds,
                )
            except (asyncio.TimeoutError, TimeoutError, APITimeoutError):
                self._record(False)
                return ExplanationFailure(ExplanationFailureReason.AI_TIMEOUT)
            except ValidationError:
                self._record(False)
                return ExplanationFailure(ExplanationFailureReason.AI_INVALID_RESPONSE)
            except Exception:
                # SDK errors, including auth, rate limit, network, and parse errors,
                # are kept inside the provider boundary. Never echo their messages.
                self._record(False)
                return ExplanationFailure(ExplanationFailureReason.AI_UNAVAILABLE)

            try:
                if response.status != "completed":
                    raise ValueError("Incomplete provider response")
                if any(
                    content.type == "refusal"
                    for item in response.output if item.type == "message"
                    for content in item.content
                ):
                    raise ValueError("Provider refused the request")
                parsed = response.output_parsed
                model = response.model
                if parsed is None or not isinstance(model, str) or not model.strip():
                    raise ValueError("Missing parsed output or model")
                explanation = ExplanationSchema.model_validate(parsed.model_dump())
                if not explanation.summary.strip() or any(
                    not item.strip()
                    for group in (explanation.strengths, explanation.risks, explanation.recommendations)
                    for item in group
                ):
                    raise ValueError("Empty explanation field")
            except Exception:
                # Malformed provider objects may fail at any field access or schema check.
                self._record(False)
                return ExplanationFailure(ExplanationFailureReason.AI_INVALID_RESPONSE)
            self._record(True)
            return ExplanationSuccess(explanation, model)
        finally:
            async with self._slot_lock:
                self._occupied = False
