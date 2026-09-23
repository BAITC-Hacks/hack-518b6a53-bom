"""FastAPI application and readiness lifecycle."""

import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from openai import AsyncOpenAI

from backend.adapters.dataset import load_dataset
from backend.adapters.llm import OpenAIExplanationAdapter
from backend.domain.simulation import simulate
from backend.routes import error_response, router
from backend.services.explanations import ExplanationService
from backend.services.scenarios import ScenarioService
from backend.settings import load_settings


logger = logging.getLogger(__name__)
MAX_BODY_BYTES = 16 * 1024


class BodyLimitMiddleware:
    """Count received ASGI chunks and buffer only bodies within the limit."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        chunks: list[bytes] = []
        total = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                await error_response(422, "INVALID_BODY", "Тело запроса получено не полностью")(scope, receive, send)
                return
            if message["type"] != "http.request":
                continue
            chunk = message.get("body", b"")
            total += len(chunk)
            if total > MAX_BODY_BYTES:
                await error_response(413, "BODY_TOO_LARGE", "Тело запроса превышает 16 КиБ")(scope, receive, send)
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break

        body = b"".join(chunks)
        sent = False

        async def replay() -> dict[str, Any]:
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


class ReadinessGateMiddleware:
    """Reject application requests before parsing input while data is unavailable."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] == "http" and scope.get("path") in {
            "/api/v1/catalog", "/api/v1/validate", "/api/v1/evaluate", "/api/v1/explain",
        } and getattr(scope["app"].state, "scenario_service", None) is None:
            await error_response(503, "DATASET_NOT_READY", "Данные модели не готовы")(scope, receive, send)
            return
        await self.app(scope, receive, send)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.scenario_service = None
    app.state.explanation_service = None
    settings = load_settings()
    client = (
        AsyncOpenAI(
            api_key=settings.openai_api_key,
            base_url="https://api.openai.com/v1",
            max_retries=0,
        )
        if settings.ai_configured else None
    )
    adapter = OpenAIExplanationAdapter(settings, client)
    app.state.ai_adapter = adapter
    try:
        dataset = load_dataset(settings.data_dir)
        baseline = simulate(dataset, ())
        app.state.scenario_service = ScenarioService(dataset, baseline)
        app.state.explanation_service = ExplanationService(app.state.scenario_service, adapter)
    except Exception:
        logger.exception("Dataset or baseline initialization failed")
    try:
        yield
    finally:
        app.state.explanation_service = None
        app.state.scenario_service = None
        if client is not None:
            await client.close()


app = FastAPI(lifespan=lifespan)
app.add_middleware(BodyLimitMiddleware)
app.add_middleware(ReadinessGateMiddleware)
app.include_router(router)


@app.exception_handler(RequestValidationError)
async def request_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    errors = []
    for item in exc.errors():
        location = item.get("loc", ())
        path = ""
        for part in location:
            if part in ("body", "query", "path") and not path:
                continue
            path += f"[{part}]" if isinstance(part, int) else (f".{part}" if path else str(part))
        errors.append({"code": "INVALID_REQUEST", "message": "Некорректное поле запроса", "path": path})
    return JSONResponse(status_code=422, content={"errors": errors, "score": None})


@app.exception_handler(Exception)
async def internal_error(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unexpected request failure")
    return error_response(500, "INTERNAL_ERROR", "Внутренняя ошибка сервера")


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
    return error_response(exc.status_code, "HTTP_ERROR", "Запрос не может быть обработан")
