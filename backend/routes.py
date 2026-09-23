"""HTTP transport for the loaded Tech2 scenario service."""

from collections.abc import Mapping
from dataclasses import fields, is_dataclass
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from backend.domain.models import Selection
from backend.services.scenarios import InvalidScenario, ModelVersionMismatch, ScenarioService
from shared.schemas import (
    CatalogResponse, ErrorResponse, EvaluateResponse, LiveHealthResponse,
    ReadyHealthResponse, ScenarioRequest, ValidateResponse,
)


router = APIRouter()


def error_response(status_code: int, code: str, message: str, path: str = "") -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=ErrorResponse(errors=[{"code": code, "message": message, "path": path}], score=None).model_dump(),
    )


def to_plain(value: Any) -> Any:
    """Copy immutable domain objects into data accepted by HTTP schemas."""
    if isinstance(value, Selection):
        result = {"measure_id": value.measure_id}
        if value.district_id is not None:
            result["district_id"] = value.district_id
        return result
    if is_dataclass(value) and not isinstance(value, type):
        return {field.name: to_plain(getattr(value, field.name)) for field in fields(value)}
    if isinstance(value, Mapping):
        return {key: to_plain(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [to_plain(item) for item in value]
    return value


def scenario_service(request: Request) -> ScenarioService | JSONResponse:
    service = getattr(request.app.state, "scenario_service", None)
    if service is None:
        return error_response(503, "DATASET_NOT_READY", "Данные модели не готовы")
    return service


def _selections(body: ScenarioRequest) -> tuple[Selection, ...]:
    return tuple(Selection(item.measure_id, item.district_id) for item in body.selections)


@router.get("/api/v1/catalog", response_model=CatalogResponse)
def catalog(service: ScenarioService | JSONResponse = Depends(scenario_service)) -> Any:
    if isinstance(service, JSONResponse):
        return service
    dataset = service.dataset
    return CatalogResponse.model_validate(to_plain({
        "model_version": dataset.model_version,
        "districts": tuple(dataset.districts.values()),
        "measures": tuple(dataset.measures.values()),
        "rules": dataset.rules,
        "baseline": service.baseline.after,
        "presets": dataset.presets,
    }))


@router.post("/api/v1/validate", response_model=ValidateResponse)
def validate(body: ScenarioRequest, service: ScenarioService | JSONResponse = Depends(scenario_service)) -> Any:
    if isinstance(service, JSONResponse):
        return service
    try:
        result = service.validate_draft(body.model_version, _selections(body))
    except ModelVersionMismatch:
        return error_response(409, "MODEL_VERSION_MISMATCH", "Неизвестная версия модели", "model_version")
    return ValidateResponse.model_validate(to_plain({
        "model_version": service.dataset.model_version,
        "valid_draft": result.valid_draft,
        "can_evaluate": result.can_evaluate,
        "budget": result.budget,
        "errors": result.errors,
    }))


@router.post("/api/v1/evaluate", response_model=EvaluateResponse)
def evaluate(body: ScenarioRequest, service: ScenarioService | JSONResponse = Depends(scenario_service)) -> Any:
    if isinstance(service, JSONResponse):
        return service
    try:
        report = service.evaluate(body.model_version, _selections(body))
    except ModelVersionMismatch:
        return error_response(409, "MODEL_VERSION_MISMATCH", "Неизвестная версия модели", "model_version")
    except InvalidScenario as exc:
        return JSONResponse(
            status_code=422,
            content=ErrorResponse(errors=to_plain(exc.errors), score=None).model_dump(),
        )
    return EvaluateResponse.model_validate(to_plain(report))


@router.get("/health/live", response_model=LiveHealthResponse)
def live() -> LiveHealthResponse:
    return LiveHealthResponse(status="live")


@router.get("/health/ready", response_model=ReadyHealthResponse)
def ready(request: Request) -> ReadyHealthResponse | JSONResponse:
    if getattr(request.app.state, "scenario_service", None) is None:
        return JSONResponse(status_code=503, content=ReadyHealthResponse(status="not_ready").model_dump())
    return ReadyHealthResponse(status="ready")
