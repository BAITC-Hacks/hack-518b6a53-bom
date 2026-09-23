# Контракт бэкэнда MVP «Аким на 5 часов»

## Источники и границы

Приоритет: (1) текущий запрос пользователя и его явные уточнения; (2) `data.md`, Tech2; (3) `ARCHITECTURE_PYTHON_DOCKER.md`; (4) этот контракт, если он не противоречит первым трём; (5) `architechture.md` для пояснений и числовых ориентиров. Tech2 задаёт исходные данные, формулу и бизнес-правила. При расхождении дополнительной архитектуры с текущим заданием используется текущее задание: ID Есиля — `yesil`, не `esil`.

MVP содержит только Python-бэкэнд. Расчётное ядро определяет числа и допустимость сценария. Внешний OpenAI API формулирует объяснение уже рассчитанного результата и не меняет Score. Модель приложения задаётся только `OPENAI_MODEL`; имя модели агента разработки не является её ID. Локальная Ollama, UI, БД, авторизация, история, очереди, RAG и агенты в приложении не входят в MVP. Dockerfile и Compose относятся к этапу 8. Сценарии не сохраняются.

Направления: `transport`, `ecology`, `social`, `safety`, `services`. Индикаторы: `T1`, `T2`, `E1`, `E2`, `S1`, `S2`, `B1`, `B2`, `C1`, `C2`. Районы: `yesil`, `almaty`, `saryarka`, `baikonur`, `nura`. Меры: `M1`–`M14`. Транспорт принимает произвольные строки ID, чтобы доменный валидатор мог сообщить `UNKNOWN_MEASURE` и `UNKNOWN_DISTRICT`. Загрузчик проверяет полный точный набор ID в версионированных данных.

## Этапы и владение

| Этап | Владелец файлов | Результат |
|---|---|---|
| 1 | `backend/domain/models.py`, `shared/schemas.py`, `backend/settings.py`, этот контракт, конфигурационные примеры | Неизменяемые структуры и HTTP-схемы |
| 2 | `data/tech2-v1/`, `backend/adapters/dataset.py` | Точные данные Tech2 и проверенная загрузка |
| 3 | `backend/domain/validation.py` | Черновая и окончательная проверка |
| 4 | `backend/domain/simulation.py`, `backend/domain/report.py` | Числовое ядро и отчёт |
| 5 | `backend/main.py`, `backend/routes.py`, `backend/services/scenarios.py` | FastAPI, catalog/validate/evaluate и live/ready |
| 6 | `backend/services/explanations.py`, `backend/adapters/fallback.py`, `backend/prompts/explanation.txt` | Серверные факты и шаблонное объяснение |
| 7 | `backend/adapters/llm.py`, explain и health/ai в маршрутах | OpenAI API и явный fallback |
| 8 | `docker/`, Compose, зависимости, README | Упаковка и инструкция запуска |

`backend/domain` использует только стандартную библиотеку Python. Он не читает окружение и не импортирует HTTP, Pydantic или OpenAI. `services` собирает операции; `adapters` читает данные и обращается к внешнему API; `routes` переводит доменные значения в `shared/schemas.py`. Бизнес-константы живут в версионированных данных, не в настройках или схемах. Все публичные сервисы вызывают `validate_scenario(..., final=True)` перед `simulate`. Единственный допустимый вызов `simulate` с пустым набором — внутренний расчёт baseline. Валидация черновика не рассчитывает Score.

## Доменные структуры и функции

Структуры объявлены в `backend/domain/models.py` как frozen dataclasses со slots. Коллекции в них — кортежи и защитно скопированные `MappingProxyType`, включая словари индикаторов, эффектов и вложенные добавки меры. Загрузчик создаёт эти структуры только после проверки содержимого файлов.

| Тип | Поля и типы |
|---|---|
| `District` | `id: str`, `name: str`, `population_share: float`, `indicators: Mapping[str, float]` |
| `Measure` | `id: str`, `title: str`, `direction: Direction`, `scope: Scope`, `cost: int`, `lag: int`, `effects: Mapping[str, float]` |
| `Synergy` | `first_measure_id: str`, `second_measure_id: str`, `indicator: str`, `bonus: float` |
| `Conflict` | `first_measure_id: str`, `second_measure_id: str`, `scope: global \| same_district` |
| `Rules` | `budget_limit: int`, `required_decisions: int`, `max_per_direction: int`, `horizon_quarters: int`, `critical_threshold: float`, `critical_penalty: float`, `average_weight: float`, `minimum_weight: float`, `indicator_weights: Mapping[str, float]`, `synergies: tuple[Synergy, ...]`, `conflicts: tuple[Conflict, ...]` |
| `Selection` | `measure_id: str`, `district_id: str \| None` |
| `Preset` | `id: str`, `title: str`, `selections: tuple[Selection, ...]` |
| `Dataset` | `model_version: str`, `districts: Mapping[str, District]`, `measures: Mapping[str, Measure]`, `rules: Rules`, `presets: tuple[Preset, ...]` |
| `ValidationError` | `code: str`, `message: str`, `path: str` |
| `Budget` | `limit: int`, `spent: int \| None`, `remaining: int \| None` |
| `ValidationResult` | `valid_draft: bool`, `can_evaluate: bool`, `budget: Budget`, `errors: tuple[ValidationError, ...]` |
| `DistrictSnapshot` | `id: str`, `district_score: float`, `indicators: Mapping[str, float]` |
| `CriticalPair` | `district_id: str`, `indicator: str`, `value: float` |
| `Snapshot` | `score: float`, `average: float`, `minimum: float`, `weakest_district_ids: tuple[str, ...]`, `districts: tuple[DistrictSnapshot, ...]`, `critical_pairs: tuple[CriticalPair, ...]` |
| `IndicatorChange` | `district_id: str`, `indicator: str`, `before: float`, `after: float`, `delta: float` |
| `MeasureEffect` | `measure_id: str`, `district_id: str \| None`, `cost: int`, `lag: int`, `realized_fraction: float`, `additions: Mapping[str, Mapping[str, float]]` |
| `SynergyEffect` | `first_measure_id: str`, `second_measure_id: str`, `district_id: str`, `indicator: str`, `bonus: float` |
| `SimulationResult` | `after: Snapshot`, `measure_effects: tuple[MeasureEffect, ...]`, `synergy_effects: tuple[SynergyEffect, ...]` |
| `ScenarioReport` | `model_version: str`, `scenario_key: str`, `selections: tuple[Selection, ...]`, `budget: Budget`, `baseline: Snapshot`, `after: Snapshot`, `score_delta: float`, `indicator_changes: tuple[IndicatorChange, ...]`, `measure_effects: tuple[MeasureEffect, ...]`, `synergy_effects: tuple[SynergyEffect, ...]` |

Сигнатуры будущих реализаций (на этапе 1 файлов с заглушками для этих функций нет):

```python
def load_dataset(path: str | Path) -> Dataset: ...
def validate_scenario(dataset: Dataset, selections: tuple[Selection, ...], *, final: bool) -> ValidationResult: ...
def simulate(dataset: Dataset, selections: tuple[Selection, ...]) -> SimulationResult: ...
def build_report(dataset: Dataset, selections: tuple[Selection, ...], simulation: SimulationResult, baseline: SimulationResult) -> ScenarioReport: ...
```

`validate_scenario(final=False)` допускает 0–5 мер, но проверяет остальные применимые правила. `final=True` требует ровно пять. Только неизвестная мера оставляет `spent` и `remaining` равными `None`; `limit` остаётся известен. Неизвестный район даёт ошибку валидации, но не скрывает стоимость известных мер. Для полностью известного набора `remaining = limit - spent`, даже если число отрицательное. `can_evaluate` истинно только для валидных пяти решений. Порядок решений не влияет на результат: ключ сценария и отчёт сортируют их по числовой части ID меры. Пример ключа: `tech2-v1|M5@saryarka|M7@nura|M8@nura|M10@nura|M12@city`.

Числа рассчитываются по Tech2 без промежуточного округления: реализованная доля меры `(H − lag) / H`, затем сумма эффектов и фиксированных синергий, один clip индикаторов в `[0,100]`, взвешенные районные оценки, средняя по населению, минимум и штраф за каждую пару со значением строго меньше порога. Остаток бюджета не даёт бонуса. `MeasureEffect.additions` содержит добавки по целевым районам после лага, до clip; `SynergyEffect` отделён от меры; `IndicatorChange` показывает фактическую итоговую дельту. Независимый вклад меры в Score не рассчитывается.

## HTTP-контракт

Все имена полей — `snake_case`; все Pydantic v2 модели запрещают неизвестные поля. Обязательные поля должны присутствовать. Запрос для validate, evaluate и explain: только `model_version: str` и `selections: list[SelectionSchema]`. Каждое решение содержит только `measure_id: str` и опциональный `district_id: str`. Если район отсутствует, транспортная модель ставит внутреннее `None`; явный JSON `null` отвергается схемой. Проверку соответствия району/городу делает доменный валидатор по каталогу. Клиент не передаёт бюджет, эффект, Score, prompt или отчёт.

| Метод | Успешный ответ HTTP 200 |
|---|---|
| `GET /api/v1/catalog` | `model_version`, `districts: DistrictCatalog[]`, `measures: MeasureCatalog[]`, `rules: PublicRules`, `baseline: Snapshot`, `presets: Preset[]` |
| `POST /api/v1/validate` | `model_version`, `valid_draft: bool`, `can_evaluate: bool`, `budget: Budget`, `errors: Error[]`; поля Score нет |
| `POST /api/v1/evaluate` | `model_version`, `scenario_key`, `selections`, `budget`, `baseline: Snapshot`, `after: Snapshot`, `score_delta`, `indicator_changes`, `measure_effects`, `synergy_effects` |
| `POST /api/v1/explain` | `model_version`, `scenario_key`, `mode: llm \| fallback`, `llm_model: str \| null`, `explanation: Explanation`, `warning: Warning \| null` |
| `GET /health/live` | `{ "status": "live" }` |
| `GET /health/ready` | `{ "status": "ready" }` или HTTP 503 `{ "status": "not_ready" }` |
| `GET /health/ai` | `configured: bool`, `model: str \| null`, `last_status: not_checked \| ok \| error`, `last_checked_at: str \| null`; HTTP 200 при конфигурации и статусе not_checked/ok, иначе 503 |

`DistrictCatalog` имеет `id`, `name`, `population_share`, `indicators`. `MeasureCatalog` имеет `id`, `title`, `direction`, `scope`, `cost`, `lag`, `effects`. `PublicRules` имеет все поля `Rules` с `synergies` и `conflicts` в виде списков объектов. `Preset` имеет `id`, `title`, `selections`; готовый результат в пресете не хранится. `Snapshot` одинаков для baseline и after: `score`, `average`, `minimum`, `weakest_district_ids`, `districts`, `critical_pairs`. `DistrictSnapshot` имеет `id`, `district_score`, `indicators`; `CriticalPair` — `district_id`, `indicator`, `value`. `Budget` имеет `limit`, `spent`, `remaining`. `IndicatorChange`, `MeasureEffect` и `SynergyEffect` повторяют поля одноимённых доменных типов. `Explanation` имеет `summary: str`, `strengths: list[str]`, `risks: list[str]`, `recommendations: list[str]`. `Warning` имеет `code` и `message`.

`validate` возвращает HTTP 200 и ошибки правил в своём `errors` даже для недопустимого черновика; `can_evaluate=false`. Неверная структура самого запроса возвращает общий ответ ошибки. `evaluate` и `explain` при нарушении правил возвращают HTTP 422 и не запускают расчёт/AI. `explain` самостоятельно проверяет и пересчитывает вход; ранее вызванный evaluate не требуется. При недоступном AI валидный explain возвращает HTTP 200, `mode="fallback"`, `llm_model=null`, `warning={code,message}` и честно помеченное шаблонное объяснение. Успешный AI возвращает `mode="llm"`, реально использованный `llm_model` и `warning=null`. AI не влияет на доступность калькулятора.

Единый ответ ошибки для прикладных маршрутов: `{ "errors": [{ "code": str, "message": str, "path": str }], "score": null }`. `path` — имя поля или индексированный путь, например `selections[2].district_id`; для общей ошибки запроса — пустая строка. Коды правил: `UNKNOWN_MEASURE`, `UNKNOWN_DISTRICT`, `DISTRICT_REQUIRED`, `DISTRICT_FORBIDDEN`, `DECISION_COUNT`, `DUPLICATE_MEASURE`, `BUDGET_EXCEEDED`, `DIRECTION_LIMIT`, `INCOMPATIBLE_MEASURES`, `DISTRICT_CONFLICT`. HTTP-коды: 409 для несовпадения `model_version`, 422 для структуры и окончательного набора, 413 для тела больше 16 КиБ, 503 при неготовом датасете, 500 для непредвиденной ошибки. Ошибки не раскрывают stack trace, ключи или внутренние настройки. Лимит тела проверяется по фактически полученным байтам, включая потоковые запросы без `Content-Length`.

При сериализации числа передаются как конечные JSON numbers с вычисленной точностью; округление допустимо только при отображении клиентом. Порядок массивов районов и индикаторов следует порядку версионированных данных, мер — числовому ID. `SelectionSchema` сама опускает `district_id`, если он отсутствует: это действует и для самостоятельного решения, и для вложенных `selections` в запросе, пресете или ответе evaluate при обычной Pydantic-сериализации без специальных флагов. Для районной меры `district_id` присутствует строкой. Для городского `MeasureEffect` поле `district_id` сериализуется как `null`, поскольку сам эффект содержит добавки по всем районам. В `Budget` неизвестные `spent`/`remaining` сериализуются как `null`; `warning` и `llm_model` в explain всегда присутствуют, в том числе с `null`. Нельзя глобально применять `exclude_none=True` ко всему ответу. `scenario_key` строит сервер, а не клиент.

## Настройки

`backend/settings.py` читает только инфраструктуру: `DATA_DIR` (по умолчанию `/app/data/tech2-v1`), `LOG_LEVEL` (`INFO`), `OPENAI_API_KEY` (нет значения по умолчанию), `OPENAI_MODEL` (нет значения по умолчанию), `OPENAI_TIMEOUT_SECONDS` (`45`) и `OPENAI_MAX_OUTPUT_TOKENS` (`2000`). Пустые ключ и модель означают отсутствие AI-конфигурации и не препятствуют загрузке данных, валидации и расчёту. Бюджет, лаги, веса, пороги, эффекты, конфликты и синергии не задаются переменными окружения. `/health/ready` зависит от датасета и базового расчёта, а не от OpenAI; `/health/ai` сообщает локальную конфигурацию и результат последнего вызова без внешнего запроса.

`/health/ai` показывает только локальную конфигурацию и состояние последнего вызова в текущем процессе. Ответ 200 с `not_checked` или `ok` не подтверждает текущую доступность OpenAI. Занятость AI-слота не меняет этот статус.

`LOG_LEVEL` нормализуется без учёта регистра и допускает `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`. При старте lifespan уровень применяется к корневому логгеру и логгерам Uvicorn; неверное значение вызывает ошибку конфигурации. Ошибки маршрутизации 404/405 также используют общий ответ `errors`/`score`; заголовки HTTP-исключения, включая `Allow`, сохраняются.
