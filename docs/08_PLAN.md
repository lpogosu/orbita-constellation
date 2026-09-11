# 08. План реализации и правила работы агентов

| Статус | Обновлён | Заменяет | Агенту |
|---|---|---|---|
| Действует | 2026-09-11 | `08_implementation_plan.md`, часть `03_product_and_killer_features.md` | Порядок milestone обязателен. Задача принимается только по task card §5 и Definition of Done §6 |

## 1. Принцип

Вертикальные срезы: `schema → core → service → endpoint → UI → test`. Первый срез
доводится до экспорта раньше любых P0-функций. Фронтенд подключается к настоящему API;
мок-данные допустимы только внутри Storybook-подобных песочниц и не попадают в экраны.

## 2. Структура репозитория

```text
orbita/
  core/           пакет orbita_core (04_CORE.md §1), pyproject, тесты ядра
  api/            FastAPI: routers, services, adapters (postgres, redis, memgraph, minio, local)
  worker/         arq-задачи: run, sweep, criticality, evidence
  web/            React + TypeScript + Vite, сгенерированные типы из OpenAPI
  deploy/         docker-compose.yml, compose.degraded.yml, nginx.conf, Makefile
  docs/           эта папка
  scenarios/      четыре сценария кейса + скрытый тестовый сценарий
  README.md       запуск одной командой, порядок демонстрации
```

Расчётная логика живёт только в `core/`. `api/` и `worker/` вызывают `orbita_core`
через application services; `web/` ничего не считает.

## 3. Стек

| Слой | Выбор |
|---|---|
| ядро | Python 3.12, NumPy; собственный BFS/Dijkstra/max-flow на adjacency list; NetworkX допустим только в тестах как оракул |
| API | FastAPI, Pydantic v2, SQLAlchemy 2 + Alembic, `sse-starlette` |
| worker | arq на Redis |
| хранилища | PostgreSQL 16, Redis 7, Memgraph + MAGE (`neo4j` Python-драйвер по Bolt), MinIO (`boto3`) |
| фронтенд | React 18 + TypeScript strict, Vite, Tailwind с токенами из `07_UI.md`, ECharts для таймлайна и heatmap, Canvas 2D для карты (ADR-014), `openapi-typescript` для типов |
| качество | `ruff`, `mypy --strict`, `pytest` с `hypothesis`; `eslint`, `tsc --noEmit`, Playwright smoke |
| поставка | Docker Compose, `make up`, `make demo`, `make test` |

## 4. Milestones

### M0. Freeze
- зафиксирован scope ADR-013, стек §3, структура §2;
- OpenAPI-скелет из `05_API.md` со всеми схемами, пусть и без реализации;
- compose со всеми семью сервисами и `/api/health`;
- скрытый тестовый сценарий (ADR-015) в `scenarios/`.
**Выход:** `docker compose up` поднимает все сервисы, `/api/health` зелёный.

### M1. Ядро
- `scenario`, `geometry` (векторизация по тикам), `contacts` (bitset), `graph`;
- `routing`: `bfs_shortest`, `persistent`, `dijkstra_distance`, `disjoint_paths`;
- `diagnosis`, `metrics`, `ranking`, `export`;
- golden-тесты по `10_FIXTURES.md`, property-тесты инвариантов;
- CLI `python -m orbita_core run scenario.json --policy bfs_shortest --out result.json`.
**Выход:** четыре сценария и скрытый сценарий проходят; экспорт валиден; повторный запуск
идентичен; время ≤ 0,5 с на сценарий из 48 аппаратов.

### M2. Платформа
- миграции Postgres (`06_STORAGE.md` §3); Project/Variant/Run; `config_hash`, `engine_version`;
- arq-воркер, прогресс через Redis pub/sub и SSE; отмена; idempotency;
- адаптеры MinIO (трасса, экспорт) и Memgraph (контакты интервалами, lineage);
- локальные адаптеры и профиль `degraded`;
- preview, snapshot, timeline, metrics, outages, backup-paths, export.
**Выход:** полный пользовательский цикл через OpenAPI без фронтенда; тест degraded-профиля.

### M3. Основной интерфейс
- Проекты и загрузка с ошибками валидации (список с JSON path);
- Сеть: редактор конфигурации, preview, запуск с прогрессом, карта Canvas 2D, карточки
  клиентов, таймлайн, playback, сохранение и экспорт;
- состояния из `07_UI.md` «Системные состояния».
**Выход:** новый пользователь загружает JSON и исследует маршрут без терминала.

### M4. Outage Detective
- редактор отказов; Run before/after; панель причин с доказательствами; подсветка
  компонент; затронутые клиенты; переход к первому разрыву; тесты на все причины.

### M5. Исследования и рекомендация
- Experiment/ExperimentPoint; одномерный sweep; heatmap RAAN × phase с контуром цели;
- materialize точки в Variant; Сравнение с дельтами; Recommendation; Evidence Pack;
- сравнение политик маршрутизации на экране Сравнение.

### M6. Устойчивость и происхождение
- Resilience X-Ray (criticality по каждому спутнику, подсветка, counterfactual);
- Experiment Lineage из Memgraph;
- bridges/biconnected components на графе отсчёта.

### M7. Hardening и сдача
- лимиты и таймауты; отмена; повтор задач; cross-browser smoke;
- деплой на публичный URL из чистого клона; README с командами и порядком демонстрации;
- скринкаст 20–30 с; QR на сайт; репетиция пятиминутной защиты.

Feature freeze после M5: новые концепции не добавляются до прохождения полного demo flow.

## 5. Task card для агента

Каждая задача формулируется так и не иначе:

```text
Задача:        одно предложение
Документы:     какие разделы 01–10 читать
Входы:         файлы, схемы, фикстуры
Контракт:      endpoint / сигнатура / схема, которые должны появиться
Ожидание:      наблюдаемый результат
Негативные:    какие ошибки и краевые случаи обязаны обрабатываться
Тесты:         какие тесты добавить, какие команды прогоняют
Проверка:      команды для ручной проверки
Нельзя:        что не менять
Коммит:        префикс и scope conventional commit на русском (ADR-016)
```

## 6. Definition of Done

- код собирается; `ruff`, `mypy --strict`, `eslint`, `tsc` без ошибок;
- тесты проходят локально и в CI;
- нет hardcoded идентификаторов из сценариев кейса в универсальной логике (ADR-015);
- новый JSON того же формата обрабатывается без правки кода;
- ошибки содержат код и JSON path;
- фронтенд не использует mock data после подключения API;
- README и соответствующий документ в `docs/` обновлены;
- есть ручной smoke-сценарий в описании коммита или PR;
- комментарии в коде на русском и объясняют «почему» (ADR-016).

## 7. Красные флаги

- начинать с экранов на моках;
- бизнес-логика в React;
- хранить 720 JSON-снимков на точку sweep;
- объявлять Dijkstra «лучше» без определения весов;
- использовать LLM для числовой рекомендации (ADR-012);
- зависеть от Memgraph для обязательного BFS;
- рассчитывать только предоставленные идентификаторы;
- внедрять все функции до рабочего импорта и экспорта;
- изменять экраны без указания пользователя.

## 8. Распределение потоков

- **Core:** геометрия, граф, маршрутизация, метрики, тесты.
- **Platform:** API, воркер, Postgres, Redis, Memgraph, MinIO, compose, деплой.
- **Frontend:** дизайн-система из Figma, экраны, таймлайн, карта.
- **Analytics/Product:** sweep, рекомендация, criticality, Evidence Pack, демо, экономика.

Core не смешивается с визуальным полированием до прохождения тестов M1.
