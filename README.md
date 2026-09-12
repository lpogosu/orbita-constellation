# ОРБИТА

**Развёрнутый сервис: http://localhost:3000/projects**

Платформа для расчёта временного графа спутниковой группировки: считает сквозную
достижимость «клиент → спутники → шлюз» на суточной сетке, объясняет причины разрывов
связи и помогает выбрать устойчивую конфигурацию.

Решение кейса «Проектирование устойчивой спутниковой группировки» КосмоХакатона 2026.
Материалы организаторов — в [`case/`](case/README.md).

## Проверяющему — за пять минут

| Куда смотреть | Что там |
|---|---|
| http://localhost:3000/projects | работающий сервис: загрузить сценарий, посчитать сутки, разобрать отказ, сравнить варианты |
| [`docs/20_CRITERIA.md`](docs/20_CRITERIA.md) | разбор каждого критерия оценки: чем закрыт, где лежит, как проверить |
| [`docs/19_ANALYSIS.md`](docs/19_ANALYSIS.md) | выводы и рекомендации по группировке с числами из наших расчётов |
| [`docs/17_ARCHITECTURE_BRIEF.md`](docs/17_ARCHITECTURE_BRIEF.md) | архитектура решения одним документом |
| `make up` | весь стек локально одной командой, см. «Запуск» |

Две команды, которые показывают, что расчёт верен:

```bash
cd core && pip install -e ".[dev]" && cd ..
python -m orbita_core crosscheck scenarios/01_full_constellation.json --ticks 0,120,43200,86280
python -m orbita_core golden scenarios
```

![Сверка ядра: golden-значения и сравнение с эталонным расчётным модулем](docs/assets/core-checks.gif)

Первая сверяет наше ядро с официальным расчётным модулем организаторов
(`case/geometry/geometry.py`): расхождение позиций — 9,1·10⁻¹³ км, расхождений в составе
линий связи — ноль. Вторая сверяет 48 итоговых показателей по четырём сценариям кейса с
таблицей [`docs/10_FIXTURES.md`](docs/10_FIXTURES.md): 48 проверок, 0 расхождений.

Нормативные документы продукта — в [`docs/`](docs/README.md): постановка (`01_SPEC.md`),
архитектурные решения (`02_DECISIONS.md`), имена и enum (`03_GLOSSARY.md`), ядро, API,
хранение и интерфейс.

## Структура

```text
core/       пакет orbita_core: геометрия, граф, маршрутизация, метрики (чистый Python + NumPy)
api/        FastAPI: валидация, проекты, запуски, экспорт, SSE
worker/     arq-задачи: суточные расчёты, sweep, criticality, Evidence Pack
web/        интерфейс: Vite + React + TypeScript, собирается в статику за nginx
deploy/     docker-compose, профиль degraded, nginx.conf, Makefile
scenarios/  четыре сценария кейса и скрытый тестовый сценарий в формате cosmo-A-1.0
case/       материалы организаторов: исходные данные, эталонный geometry.py, PDF кейса
docs/       документы продукта
```

Расчётная логика живёт только в `core/`; `api/` и `worker/` вызывают её как библиотеку
(ADR-001). Фронтенд ничего не считает: состав группировки, метрики и ошибки он получает
из API через тот же reverse proxy, на одном origin со страницей.

## Ядро из командной строки

Расчёт доступен без стека, из пакета `core/`:

```bash
cd core && python -m venv .venv && source .venv/Scripts/activate && pip install -e ".[dev]"
python -m orbita_core validate ../scenarios/01_full_constellation.json
python -m orbita_core run ../scenarios/01_full_constellation.json --policy bfs_shortest --out result.json
python -m orbita_core golden ../scenarios
python -m orbita_core crosscheck ../scenarios/01_full_constellation.json --ticks 0,120,43200,86280
```

| Команда | Что делает |
|---|---|
| `validate` | все ошибки сценария списком с кодом и JSON path; код возврата 1 при ошибках |
| `run` | сутки расчёта, таблица метрик по клиентам и конфигурации, экспорт `cosmo-A-result-1.0` |
| `golden` | сверка четырёх сценариев с таблицей `docs/10_FIXTURES.md` §1; числа берутся из документа |
| `crosscheck` | сверка позиций и рёбер с официальным `case/geometry/geometry.py` на выбранных отсчётах |

Повторный `run` одной конфигурации даёт байт-в-байт тот же файл экспорта.

## Запуск

```bash
make up
```

Команда собирает образы, поднимает семь сервисов и возвращает управление, только когда
все health-проверки прошли.

| Адрес | Что это |
|---|---|
| http://localhost:3000 | интерфейс: экран «Проекты» |
| http://localhost:8000/api/health | состояние сервисов и флаг `degraded_mode` |
| http://localhost:8000/api/docs | OpenAPI |
| http://localhost:9001 | консоль MinIO |

```bash
make demo    # поднять стек, показать health, version и проверить очередь целиком
make test    # ruff, mypy --strict и pytest для core, api и worker
make down    # остановить стек, тома сохранить
```

`make test` выполняется в том же образе, что и сервисы, поэтому локально установленный
Python не нужен.

### Порты

Порты на хосте задаются переменными; значения по умолчанию — в
[`deploy/.env.example`](deploy/.env.example). Postgres и Redis публикуются со сдвигом
(15432 и 16379), потому что 5432 и 6379 на машине разработчика обычно уже заняты.
Чтобы изменить их, скопируйте файл в `deploy/.env`.

| Сервис | Переменная | По умолчанию |
|---|---|---|
| web | `WEB_PORT` | 3000 |
| api | `API_PORT` | 8000 |
| postgres | `POSTGRES_PORT` | 15432 |
| redis | `REDIS_PORT` | 16379 |
| memgraph | `MEMGRAPH_PORT` | 7687 |
| minio | `MINIO_API_PORT`, `MINIO_CONSOLE_PORT` | 9000, 9001 |

### База и миграции

Схема Postgres описана миграциями Alembic (`api/orbita_api/db/migrations`). Контейнер
`api` перед стартом uvicorn выполняет `alembic upgrade head`, поэтому `make up` поднимает
стек с готовой схемой и отдельной команды не требует. Ревизия `0001` создаёт все таблицы
`docs/06_STORAGE.md` §3, `0002` делает уникальность запусков частичной и разрешает
отсутствие метрик переходов, `0003` добавляет `runs.degraded_mode` и
`config_metrics.outage_count_by_cause`.

Адрес базы задаётся одной переменной и для приложения, и для миграций:

| Переменная | Где нужна | По умолчанию |
|---|---|---|
| `ORBITA_POSTGRES_DSN` | api, worker, `alembic upgrade head` | `postgresql+asyncpg://orbita:orbita@postgres:5432/orbita` |
| `ORBITA_TEST_DATABASE_URL` | тесты api | не задана: базу поднимает testcontainers |
| `ORBITA_REDIS_URL` | api, worker | `redis://redis:6379/0` |
| `ORBITA_TEST_REDIS_URL` | тесты api | не задана: Redis поднимает testcontainers |

Применить миграции вручную (например, к базе поднятого стека с хоста):

```bash
cd api
ORBITA_POSTGRES_DSN=postgresql+asyncpg://orbita:orbita@localhost:15432/orbita   alembic -c alembic.ini upgrade head
```

Интеграционные тесты api сами поднимают контейнеры `postgres:16` и `redis:7.4`. Если
заданы `ORBITA_TEST_DATABASE_URL` и `ORBITA_TEST_REDIS_URL`, используются они; если нет
ни того, ни другого — тесты помечаются `skip`, поэтому `make test` в образе проверок, у
которого нет доступа к сокету Docker, остаётся зелёным.

### Режимы хранения

Артефакты запуска лежат в двух местах: объекты (`trace.bin`, `export.json`,
`evidence.zip`) — в MinIO по ключам `runs/{run_id}/…`, временной граф контактов и
происхождение вариантов — в Memgraph. Метрики всегда в Postgres: они нужны каждому экрану
и от внешних хранилищ не зависят.

У каждого внешнего хранилища есть локальная замена, поэтому обязательный расчёт доходит
до конца и без них (`docs/06_STORAGE.md` §7):

| Хранилище | Основная реализация | Замена | Что теряется |
|---|---|---|---|
| объекты | MinIO (`s3://orbita/runs/…`) | каталог на диске | ничего: трасса и экспорт на месте |
| граф | Memgraph | пустая заглушка | графовые запросы и lineage из Memgraph |

| Переменная | Что задаёт | По умолчанию |
|---|---|---|
| `ORBITA_STORAGE_MODE` | `auto` — по доступности, `local` — только локальные адаптеры, `full` — только внешние | `auto` |
| `ORBITA_MINIO_BUCKET` | бакет объектов; создаётся при первом обращении | `orbita` |
| `ORBITA_ARTIFACTS_DIR` | каталог локальных артефактов | `var/artifacts` |
| `ORBITA_STORAGE_TIMEOUT_S` | таймаут чтения и записи объектов | `15` |

Срок хранения из `docs/06_STORAGE.md` §6 объект получает тегом `retention`, а удаляют его
lifecycle-правила бакета: сутки для трассы интерактивного запуска, семь дней для трассы
точки sweep, без срока для экспорта. Тот же срок попадает в колонку `expires_at` таблицы
`artifacts`. У локального каталога автоматической уборки нет — это запасной путь, а не
постоянное место для трасс.

Если MinIO или Memgraph отказал **после** расчёта, метрики не теряются: артефакт уходит в
локальный каталог, запуск помечается `degraded_mode`, а транзакция Postgres доходит до
коммита. Исключение наружу выходит только тогда, когда недоступен и локальный каталог:
сохранять трассу в этом случае некуда.

### Профиль degraded

Проверяет требование `06_STORAGE.md` §7: api обязан работать, когда Redis, Memgraph и
MinIO недоступны.

```bash
make degraded
curl -s localhost:8000/api/health
make down
```

Цель `degraded` сначала выполняет `make down`. Это не перестраховка: сервис, попавший в
неактивный профиль, compose не останавливает, а просто перестаёт замечать, поэтому после
`make up` в стеке остались бы работающие Redis, Memgraph и MinIO, и профиль проверял бы
только адреса в настройках. После остановки поднимаются ровно `postgres`, `api` и `web`,
а адреса остальных хранилищ указывают на несуществующие хосты. Артефакты запусков пишутся
в том `/var/lib/orbita/artifacts`. Ожидаемый ответ:

```json
{"services":{"api":"up","postgres":"up","redis":"down","memgraph":"down","minio":"down","worker":"down"},
 "degraded_mode":true}
```

## Фронтенд

Интерфейс живёт в `web/`: Vite 6, React 18, TypeScript `strict`, Tailwind. В образе
сборка превращается в статику, которую отдаёт тот же nginx, что проксирует `/api/`, —
браузер видит страницу и API на одном origin, поэтому CORS не нужен, а адрес API не
попадает в сборку.

```bash
cd web
npm install
npm run dev        # http://localhost:5173, /api проксируется на localhost:8000
npm run lint       # eslint: typescript-eslint strictTypeChecked, any запрещён
npm run typecheck  # tsc --noEmit для приложения и для конфигов сборки
npm run build      # проверка типов + сборка в web/dist
```

`npm run dev` ждёт поднятый api. Если он опубликован на другом адресе, задайте
`ORBITA_API_ORIGIN` перед запуском.

### Токены

Цвета, радиусы, тени, шрифты и шкала размеров вынесены в CSS-переменные
[`web/src/styles/tokens.css`](web/src/styles/tokens.css) и подключены к теме Tailwind в
[`web/tailwind.config.ts`](web/tailwind.config.ts). Компоненты пользуются именами ролей
(`bg-surface-raised`, `text-ink-secondary`, `rounded-2xl`), а не значениями, поэтому
светлая и тёмная темы отличаются только набором переменных на `<html data-theme>`.

### Типы API

Типы запросов и ответов не пишутся руками: они генерируются из OpenAPI и лежат в
`web/src/api/schema.d.ts`. После изменения схем в `api/` поднимите api и обновите файл:

```bash
uvicorn orbita_api.main:app --port 8000   # в отдельном терминале
cd web && npm run api:types
```

Сгенерированный файл коммитится: сборка фронтенда не должна требовать запущенного
бэкенда.

### Примеры сценариев

Четыре примера на экране «Проекты» — это файлы `scenarios/` репозитория. Endpoint со
списком примеров в API нет, поэтому каталог отдаёт nginx: `GET /scenarios/` возвращает
список файлов (`autoindex_format json`), `GET /scenarios/<имя>` — сам файл. Названия
карточек берутся из `meta.title` файлов. В `npm run dev` тот же каталог отдаёт плагин
[`web/vite/scenarios-dir.ts`](web/vite/scenarios-dir.ts).

## Сервисы

```mermaid
flowchart LR
    WEB[web: nginx] -->|HTTP, SSE| API[api: FastAPI]
    API -->|enqueue| REDIS[(redis)]
    REDIS -->|jobs| WORKER[worker: arq]
    API --> CORE[orbita_core]
    WORKER --> CORE
    API --> PG[(postgres)]
    WORKER --> PG
    WORKER --> MINIO[(minio)]
    WORKER --> MG[(memgraph + MAGE)]
    API --> MG
    API --> MINIO
```

Роль каждого сервиса и оценка роста нагрузки — в `docs/06_STORAGE.md`.

## Как api видит воркер

Прямого канала между api и воркером нет. arq раз в 10 секунд обновляет в Redis ключ
`arq:queue:health-check` с временем жизни чуть больше периода записи; `/api/health`
проверяет наличие этого ключа. Отсюда два следствия:

- воркер показывается как `down`, если недоступен Redis, — задачи через мёртвую очередь
  до него всё равно не дойдут;
- имя ключа задано в двух местах: `worker/orbita_worker/settings.py` (`WORKER_HEALTH_KEY`)
  и в настройках api (`ORBITA_WORKER_HEALTH_KEY`). Это контракт очереди, и меняется он
  сразу в обоих.

Наличие ключа говорит лишь о том, что процесс воркера жив. Полный путь
api → Redis → worker → результат проверяет `make demo`: он ставит задачу `ping` и ждёт
ответ с версией ядра воркера.

## Очередь расчётов

Суточный расчёт идёт в воркере, а не в процессе api: ядро считает синхронно и держит GIL,
поэтому расчёт внутри обработчика запроса остановил бы весь сервис.

```text
POST /api/runs        api создаёт Run (queued) и ставит задачу в arq, id задачи = id Run
                      → 202 и Run; 200, если такой расчёт уже есть
worker                validate → geometry → contacts → routing → analytics → persist → complete
                      каждая смена стадии: строка runs в Postgres + событие в канал run:{id}
GET /api/runs/{id}/events   SSE: текущее состояние, затем события канала; закрывается на
                            конечном статусе, heartbeat-комментарий раз в 15 с
GET /api/runs/{id}          то же состояние опросом, когда SSE недоступен
POST /api/runs/{id}/cancel  флаг run:{id}:cancel; расчёт видит его между стадиями
```

Расчёт выполняется в отдельном потоке воркера: event loop остаётся свободным, поэтому
воркер продолжает отмечаться живым и успевает заметить отмену.

**Повторный запуск ничего не пересчитывает.** Ключ переиспользования — `config_hash`
(sha256 канонического сценария и политики маршрутизации) вместе с `engine_version`
(ADR-011). Если такой Run уже успешен, идёт или стоит в очереди, `POST /api/runs`
возвращает его с кодом 200. Заголовок `Idempotency-Key` решает другую задачу — повтор
одного и того же HTTP-запроса при обрыве связи; ключ живёт в Redis сутки, а тот же ключ с
другим телом даёт 409.

**Отмена.** Стоящий в очереди Run отменяется сразу: воркер, добравшись до задачи, увидит
конечный статус и считать не станет. Идущий расчёт прерывает сам воркер — колбэк
прогресса проверяет флаг между стадиями и бросает исключение, — поэтому ответ на отмену
возвращает `running`, а `cancelled` приходит событием прогресса.

**Degraded mode.** Если Redis недоступен, `POST /api/runs` выполняет расчёт в процессе
api фоновой задачей (в отдельном потоке, как и в воркере) и помечает ответ заголовком
`X-Degraded-Mode: true`; поток событий переходит с pub/sub на опрос Postgres раз в
секунду. Обязательный расчёт при этом работает целиком, теряются только очередь и
идемпотентность по ключу (`06_STORAGE.md` §7).

## Полный цикл через API

Всё, что нужно для расчёта и защиты результата, доступно без интерфейса. Команды ниже
выполняются из корня репозитория на поднятом стеке и используют `jq`.

```bash
# 1. Проверить файл: 200 — сводка сценария, 400 — все найденные ошибки списком
curl -s -X POST localhost:8000/api/scenarios/validate \
  -H 'Content-Type: application/json' \
  --data-binary @scenarios/01_full_constellation.json | jq .

# 2. Завести проект; вместе с ним появляется первый вариант
VARIANT=$(jq -n --slurpfile file scenarios/01_full_constellation.json \
    '{title: "Полярная группировка", scenario: $file[0]}' \
  | curl -s -X POST localhost:8000/api/projects -H 'Content-Type: application/json' -d @- \
  | jq -r .active_variant_id)

# 3. Посчитать сутки: 202 — новый расчёт, 200 — готовый с тем же config_hash (ADR-011)
RUN=$(curl -s -X POST localhost:8000/api/runs -H 'Content-Type: application/json' \
    -d "{\"variant_id\": \"$VARIANT\"}" | jq -r .id)

# 4. Дождаться конца: поток закрывается сам на конечном статусе
curl -sN localhost:8000/api/runs/$RUN/events
```

Результат читается семью запросами. Клиентский пункт берётся из самого ответа, а не
вписывается руками: идентификаторы приходят из файла сценария.

```bash
CLIENT=$(curl -s "localhost:8000/api/runs/$RUN/snapshot?t_s=0" | jq -r .clients[0].client_id)

curl -s localhost:8000/api/runs/$RUN/metrics  | jq .config
curl -s localhost:8000/api/runs/$RUN/outages  | jq '[.[] | .primary_cause] | group_by(.) | map({(.[0]): length}) | add'
curl -s localhost:8000/api/runs/$RUN/timeline | jq '{total_ticks, step_s, clients: [.clients[].client_id]}'
curl -s "localhost:8000/api/runs/$RUN/snapshot?t_s=21600" | jq '.clients[] | {client_id, reachable, path}'
curl -s "localhost:8000/api/runs/$RUN/backup-paths?t_s=21600&client_id=$CLIENT" | jq .
curl -s localhost:8000/api/runs/$RUN/export -o export.json
curl -s localhost:8000/api/runs/$RUN/evidence-pack -o evidence.zip

# Выгрузка замкнута сама на себя: её effective_scenario снова проходит валидацию
jq .effective_scenario export.json \
  | curl -s -X POST localhost:8000/api/scenarios/validate -H 'Content-Type: application/json' -d @- | jq .
```

Второй вариант, сравнение и вывод. `changed_parameters` показывает ровно то поле, которое
изменилось, а `deltas` — что это дало по метрикам.

```bash
PROJECT=$(curl -s localhost:8000/api/variants/$VARIANT | jq -r .project_id)
SECOND=$(jq '.design.planes[1].raan_deg = (.design.planes[1].raan_deg + 12
      | if . >= 360 then . - 360 else . end)' scenarios/01_full_constellation.json \
  | jq '{title: "Сдвиг ориентации плоскости", scenario: .}' \
  | curl -s -X POST localhost:8000/api/projects/$PROJECT/variants \
      -H 'Content-Type: application/json' -d @- | jq -r .id)
RUN2=$(curl -s -X POST localhost:8000/api/runs -H 'Content-Type: application/json' \
    -d "{\"variant_id\": \"$SECOND\"}" | jq -r .id)

curl -s -X POST localhost:8000/api/comparisons -H 'Content-Type: application/json' \
    -d "{\"run_ids\": [\"$RUN\", \"$RUN2\"]}" \
  | jq '.entries[1] | {changed_parameters, deltas}'
curl -s "localhost:8000/api/runs/$RUN2/recommendation?base_run_id=$RUN" \
  | jq '{recommended_run_id, deltas, target_reached, limitations}'
curl -s "localhost:8000/api/runs/$RUN2/evidence-pack?base_run_id=$RUN" -o evidence.zip
```

Отдельно от запусков работает предварительный просмотр: один отсчёт черновика без Variant
и Run, с кэшем в Redis на час.

```bash
jq -n --slurpfile file scenarios/01_full_constellation.json \
    '{scenario: $file[0], t_s: 21600}' \
  | curl -s -X POST localhost:8000/api/preview -H 'Content-Type: application/json' -d @- \
  | jq '.clients[] | {client_id, reachable, hops}'
```

Тот же цикл целиком, вместе с проверками инвариантов `docs/10_FIXTURES.md` §2, выполняет
`api/tests/test_e2e_cycle.py`: адрес стека берётся из `ORBITA_TEST_API_URL`, а без
отвечающего api тесты помечаются `skip`.

```bash
cd api && ORBITA_TEST_API_URL=http://localhost:8000 pytest -q tests/test_e2e_cycle.py
```

## Решения этого среза

- **Пробы доступности изолированы.** Любая ошибка и любое зависание сверх одной секунды
  превращаются в статус `down`: health остаётся инструментом диагностики и отвечает 200
  даже тогда, когда половина стека лежит. Сервисы опрашиваются параллельно, иначе ответ
  ждал бы сумму всех таймаутов.
- **degraded_mode объявляют только redis, memgraph и minio.** Недоступный Postgres
  показывается как `down`, но флага не поднимает: без него нет ни проектов, ни вариантов,
  и подменять его локальным адаптером нечем.
- **api и worker собираются из одного Dockerfile и одной стадии.** Расхождение версий
  ядра между ними ломало бы переиспользование готовых Run (ADR-011).
- **Трасса хранится битовой матрицей, а не снимками отсчётов** (ADR-010). Суточная трасса
  сценария кейса — 42 КБ до сжатия и 5 КБ после zstd против сотен мегабайт, если писать
  JSON на каждый отсчёт. Координаты не хранятся вовсе: ядро восстановит их из сценария.
- **Контакты уходят в Memgraph интервалами `[start_tick; end_tick)`**, а не ребром на
  каждый отсчёт: содержание то же, рёбер в сотни раз меньше.
- **Memgraph не обязателен для расчёта** (ADR-009): он обслуживает lineage и графовые
  запросы, поэтому его отказ выключает функцию, а не запуск.
- **Все образы зафиксированы по версиям**, включая MinIO, у которого версия — это тег
  релиза с датой. Официальные образы MinIO берутся с quay.io: на Docker Hub репозиторий
  закрыт.
- **Значения enum хранятся строками с CHECK**, а не типами Postgres: новое значение
  глоссария не требует миграции типа, а ограничение всё равно действует на уровне базы.
- **Миграции применяет сам контейнер api.** Отдельная цель `make migrate` означала бы, что
  её можно забыть, и стек поднимался бы с пустой базой.
- **Уникальность `runs(config_hash, engine_version)` частичная.** Пару занимают только
  запуски в очереди, в работе и успешные: иначе один упавший расчёт закрыл бы
  конфигурацию навсегда, и перезапустить её было бы нечем.
- **Прогресс измеряется стадиями, а не отсчётами.** Маршрутизация проходит всю сетку
  одним вызовом ядра и до своего конца сообщает ноль посчитанных отсчётов, поэтому полоса
  прогресса по отсчётам стояла бы, а потом прыгнула к единице.
- **Направление зависимостей между api и воркером одно.** Воркер берёт из api модели,
  репозитории и сохранение артефактов — таблицы и хранилища у процессов общие, и второй
  набор моделей разошёлся бы с первым; api импортирует из воркера только задачу расчёта и
  имена ключей Redis. Сам расчёт (`orbita_worker.runner`) не знает ни о том, ни о другом:
  функцию сохранения он получает параметром, а собирает её точка сборки процесса.
- **Результат собирается из артефактов, а не пересчитывается.** Снимок, шкала времени и
  резервные маршруты работают поверх выгрузки и трассы запуска: маршруты берутся из
  `export.json`, состояние линий связи — из `trace.bin`, координаты восстанавливает
  геометрия ядра (ADR-010). Пересчёт остаётся запасным путём на случай истёкшего срока
  хранения трассы — он детерминирован (ADR-011) и заново сохраняет артефакты.
- **Разобранный запуск живёт в памяти процесса.** Распаковка трассы и разбор выгрузки
  стоят десятки миллисекунд, а ползунок времени дёргает снимок на каждый шаг, поэтому
  последние восемь контекстов кэшируются. Всё тяжёлое считается в отдельном потоке: event
  loop api не имеет права стоять на распаковке.
- **Выгрузка отдаётся байт в байт тем же файлом, который записал расчёт.** Пересборка на
  каждый запрос давала бы тот же результат ровно до смены версии ядра, а метрики
  посчитаны по конкретному файлу (инвариант 10 `10_FIXTURES.md` §2).
- **Метрики и перерывы не пересчитываются вовсе.** Они лежат в Postgres, и `GET /metrics`
  с `GET /outages` не поднимают ни трассу, ни выгрузку: экран разбора перерывов
  открывается за один короткий запрос.
- **Evidence Pack собирается из готовых ответов API и детерминирован.** Файлы архива — то
  же, что вернут соответствующие endpoint, иначе приложенный к отчёту архив разошёлся бы с
  живой системой. Метка времени записей zip фиксирована: иначе два архива из одних данных
  отличались бы байтами.
- **Рекомендация считает только сравнимое.** Кандидаты — успешные запуски того же проекта
  с той же политикой маршрутизации; запуски на другой сетке, дальности или угле возвышения
  из набора исключаются, а сравнение двух таких запусков отвергается ошибкой с путём
  `environment.step_s` (`01_SPEC.md` §7).
- **Предварительный просмотр считает один отсчёт.** Contact plan строится на весь горизонт
  — положение аппаратов определяется сеткой времени целиком, — а маршруты ищутся только на
  запрошенном отсчёте: 720 поисков вместо одного черновик не оправдывает.
