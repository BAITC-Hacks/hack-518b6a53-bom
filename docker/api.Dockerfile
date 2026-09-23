FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements/api.lock /app/requirements/api.lock
RUN python -m pip install --no-cache-dir -r /app/requirements/api.lock \
    && useradd --uid 10001 --create-home --shell /usr/sbin/nologin api

COPY --chown=api:api backend /app/backend
COPY --chown=api:api shared /app/shared
COPY --chown=api:api data/tech2-v1 /app/data/tech2-v1

USER api
EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
