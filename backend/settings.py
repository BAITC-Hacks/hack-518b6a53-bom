"""Infrastructure configuration; no business constants live here."""

import os
from dataclasses import dataclass
from pathlib import Path


def _positive_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    value = default if raw is None else int(raw)
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


@dataclass(frozen=True, slots=True)
class Settings:
    data_dir: Path
    log_level: str
    openai_api_key: str | None
    openai_model: str | None
    openai_timeout_seconds: int
    openai_max_output_tokens: int

    @property
    def ai_configured(self) -> bool:
        return bool(self.openai_api_key and self.openai_model)


def load_settings() -> Settings:
    """Read process environment without requiring OpenAI configuration."""
    log_level = os.getenv("LOG_LEVEL", "INFO").strip().upper()
    if log_level not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
        raise ValueError("LOG_LEVEL must be DEBUG, INFO, WARNING, ERROR or CRITICAL")
    return Settings(
        data_dir=Path(os.getenv("DATA_DIR", "/app/data/tech2-v1")),
        log_level=log_level,
        openai_api_key=os.getenv("OPENAI_API_KEY") or None,
        openai_model=os.getenv("OPENAI_MODEL") or None,
        openai_timeout_seconds=_positive_int("OPENAI_TIMEOUT_SECONDS", 45),
        openai_max_output_tokens=_positive_int("OPENAI_MAX_OUTPUT_TOKENS", 900),
    )
