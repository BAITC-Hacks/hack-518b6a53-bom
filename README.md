# Аким на 5 часов — бэкэнд MVP

FastAPI принимает сценарий из пяти решений, проверяет правила Tech2 и рассчитывает показатели районов и Score в Python. Версионированный синтетический датасет `data/tech2-v1` включён в образ. OpenAI API получает уже рассчитанные факты и формулирует объяснение; он не меняет числа. При отсутствии или сбое AI сервер возвращает явно обозначенное шаблонное объяснение. Интерфейса и сохранения сценариев нет: каждый запрос содержит полный набор решений, а результаты живут только в ответах. БД, авторизации, очередей и локальной модели в MVP нет.

Правила Tech2: бюджет 100, ровно пять разных мероприятий, максимум два из одного направления, район у районных мер обязателен, несовместимости запрещены. Score учитывает взвешенные показатели районов, самый слабый район и штраф за показатели ниже 40. Промежуточные расчёты не округляются. Источник формулы и значений — [data.md](data.md), раздел Tech2.

## Запуск

Нужны Docker Engine и Docker Compose. Контекст сборки — корень репозитория. В образ копируются код и датасет, поэтому обычный запуск не использует bind mounts.

```bash
cp .env.example .env
# В .env укажите OPENAI_API_KEY и OPENAI_MODEL для реального AI.
docker compose build api
docker compose up -d api
docker compose logs -f api
docker compose down
```

`OPENAI_MODEL` — ID модели приложения в OpenAI API, которую вы выбрали и к которой у ключа есть доступ; здесь намеренно нет придуманного значения. `OPENAI_API_KEY` и `OPENAI_MODEL` должны быть заполнены вместе для AI-режима. Остальные параметры: `LOG_LEVEL=INFO`, `OPENAI_TIMEOUT_SECONDS=45`, `OPENAI_MAX_OUTPUT_TOKENS=2000`. Compose явно передаёт их контейнеру; `.env` используется только для подстановки Compose и исключён из образа. `DATA_DIR=/app/data/tech2-v1` задан в Compose и совпадает с данными в образе. Исходящий доступ контейнера к `api.openai.com` нужен для настоящего AI-объяснения.

Для разработки с монтированием только кода и датасета:

```bash
docker compose -f compose.yaml -f compose.dev.yaml up --build -d api
docker compose -f compose.yaml -f compose.dev.yaml logs -f api
docker compose -f compose.yaml -f compose.dev.yaml down
```

API опубликован только на `127.0.0.1:8000`. Swagger: <http://127.0.0.1:8000/docs>.

## HTTP-примеры

Первый пресет Tech2 доступен в каталоге. Для городской меры M12 поле `district_id` отсутствует.

```bash
curl -sS http://127.0.0.1:8000/api/v1/catalog

SCENARIO='{"model_version":"tech2-v1","selections":[{"measure_id":"M7","district_id":"nura"},{"measure_id":"M8","district_id":"nura"},{"measure_id":"M10","district_id":"nura"},{"measure_id":"M12"},{"measure_id":"M5","district_id":"saryarka"}]}'

curl -sS -X POST http://127.0.0.1:8000/api/v1/validate \
  -H 'Content-Type: application/json' -d "$SCENARIO"
curl -sS -X POST http://127.0.0.1:8000/api/v1/evaluate \
  -H 'Content-Type: application/json' -d "$SCENARIO"
curl -sS -X POST http://127.0.0.1:8000/api/v1/explain \
  -H 'Content-Type: application/json' -d "$SCENARIO"
```

`validate` проверяет и черновик, возвращает ошибки правил и бюджет, но не Score. `evaluate` требует допустимые пять решений и возвращает числовой отчёт без обращения к OpenAI. `explain` повторно проверяет и рассчитывает сценарий, затем возвращает `mode="llm"` с фактически использованной моделью либо `mode="fallback"`, `llm_model=null` и `warning`. Fallback даёт шаблон по рассчитанным фактам, а не настоящий AI-анализ. Недопустимый окончательный набор получает HTTP 422 без Score.

## Health

- `/health/live`: процесс API отвечает.
- `/health/ready`: датасет загружен и базовый расчёт подготовлен; Docker healthcheck обращается сюда и не зависит от OpenAI.
- `/health/ai`: показывает конфигурацию и статус последнего AI-вызова в текущем процессе; не делает сетевой запрос и не гарантирует текущую доступность OpenAI. Без ключа или модели возвращает 503, хотя калькулятор может быть готов.

## Ручной сценарий демонстрации

1. Откройте Swagger или запросите каталог: в нём пять районов, 14 мер и первый пресет `tech2-example`.
2. Отправьте первый пресет в `validate` и `evaluate`. Ожидаются стоимость 95 и Score около 56.54307; базовый Score около 52.56. Эти значения взяты из ориентиров Tech2 и архитектуры, сборкой или запуском здесь не проверялись.
3. Замените M8 на M3 с `district_id="nura"`: стоимость станет 105, бюджет превышен, `evaluate` отклонит расчёт с HTTP 422 и без Score.
4. С заполненными `OPENAI_API_KEY` и `OPENAI_MODEL` вызовите `explain`: при успешном ответе провайдера ожидается `mode="llm"`. Качество текста нужно оценить отдельно.
5. Очистите ключ и перезапустите API. `evaluate` остаётся доступен, а `explain` возвращает `mode="fallback"` с предупреждением. Сценарии после перезапуска не восстанавливаются.

Зависимости API закреплены в `requirements/api.lock`, полученном `uv pip compile requirements/api.in --python-version 3.12 --output-file requirements/api.lock`. Docker-образ и интеграция с OpenAI требуют отдельной проверки в целевом окружении.
