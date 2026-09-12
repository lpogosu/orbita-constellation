# 05. API и контракты данных

| Статус | Обновлён | Заменяет | Агенту |
|---|---|---|---|
| Действует | 2026-09-11 | `06_api_and_data_contracts.md` | OpenAPI генерируется из Pydantic-схем и является контрактом для фронтенда. Изменение поля = изменение здесь + миграция + тест |

Имена полей и enum — из `03_GLOSSARY.md`. Доли в [0; 1], время в секундах, расстояния в км.

## 1. Сущности

### Project
```json
{ "id": "uuid", "title": "Полярная группировка", "created_at": "ISO-8601",
  "active_variant_id": "uuid" }
```

### Variant
Неизменяемая версия сценария. Редактирование создаёт draft; сохранение draft — новый Variant.
```json
{ "id": "uuid", "project_id": "uuid", "parent_variant_id": "uuid|null",
  "title": "P2 RAAN 72", "scenario": { "...cosmo-A-1.0..." },
  "diff_from_parent": [ { "path": "design.planes[1].raan_deg", "from": 60, "to": 72 } ],
  "config_hash": "sha256", "created_at": "ISO-8601" }
```

### Run
```json
{ "id": "uuid", "variant_id": "uuid", "routing_policy": "bfs_shortest",
  "engine_version": "orbita-core-1.0.0", "config_hash": "sha256",
  "status": "queued", "stage": "validate", "progress": 0.0,
  "completed_ticks": 0, "total_ticks": 720,
  "started_at": null, "finished_at": null, "duration_ms": null,
  "trace_uri": null, "error": null }
```

### Snapshot
```json
{ "t_s": 21600,
  "satellites": [ { "id": "S01", "plane_id": "P1", "x_km": 0, "y_km": 0, "z_km": 0,
                    "active": true, "failed": false } ],
  "edges": [ { "a": "S01", "b": "S02", "distance_km": 1523.4, "kind": "isl" } ],
  "clients": [ { "client_id": "C65", "reachable": true,
                 "path": ["C65", "S01", "S17", "G_MUR"], "hops": 3,
                 "primary_cause": null, "causes": [] } ] }
```

### OutageInterval
```json
{ "client_id": "C72", "start_s": 36000, "end_s": 36960, "duration_s": 960,
  "truncated_by_horizon": false,
  "primary_cause": "NETWORK_PARTITION", "causes": ["NETWORK_PARTITION"],
  "client_visible_satellites": ["S04"], "gateway_visible_satellites": ["S31"],
  "failed_satellites": ["S14"],
  "client_component_id": 2, "gateway_component_id": 0,
  "last_path": ["C72", "S04", "S12", "G_MUR"], "next_path": ["C72", "S05", "S31", "G_MUR"] }
```

### ClientMetrics
```json
{ "client_id": "C65", "availability": 0.9667, "visibility": 0.9778,
  "max_gap_s": 480, "mean_hops": 2.29, "max_hops": 4, "route_switches": 354,
  "target_met": true, "outage_count_by_cause": { "NETWORK_PARTITION": 3 } }
```

### ConfigMetrics
```json
{ "min_client_availability": 0.9667, "mean_client_availability": 0.981,
  "worst_max_gap_s": 480, "mean_hops": 2.7, "max_hops": 5,
  "route_switches_total": 1439, "backup_path_count_min": 1,
  "outage_count_by_cause": { "NETWORK_PARTITION": 5, "NO_CLIENT_COVERAGE": 2 },
  "target_met_clients": ["C65", "C70", "C72"] }
```

### Recommendation
```json
{ "base_run_id": "uuid", "recommended_run_id": "uuid",
  "ranking_order": ["min_client_availability", "worst_max_gap_s", "mean_client_availability",
                    "backup_path_count_min", "route_switches_total", "mean_hops"],
  "changed_parameters": [ { "path": "design.planes[1].raan_deg", "from": 60, "to": 72 } ],
  "deltas": { "min_client_availability": 0.036, "worst_max_gap_s": -1440 },
  "per_client": [ { "client_id": "C65", "availability_delta": 0.036, "max_gap_delta_s": -1440 } ],
  "target_reached": true,
  "limitations": ["Проверено на сетке 120 с и горизонте 24 ч", "ISL 3000 км"] }
```

## 2. Endpoint map

### Проекты и варианты
| Метод | Путь | Назначение |
|---|---|---|
| `POST` | `/api/scenarios/validate` | только валидация файла, без сохранения; 200 — сводка сценария (плоскости, аппараты, активные аппараты, клиенты, шлюзы, отсчёты, `config_hash`) |
| `POST` | `/api/projects` | создать проект из сценария |
| `GET` | `/api/projects` | список проектов |
| `GET` | `/api/projects/{id}` | проект, варианты, последние Run |
| `POST` | `/api/projects/{id}/variants` | сохранить новый Variant (из draft или файла) |
| `GET` | `/api/variants/{id}` | вариант с diff от родителя |
| `GET` | `/api/variants/{id}/export` | effective scenario `cosmo-A-1.0` |
| `GET` | `/api/projects/{id}/lineage` | граф происхождения вариантов с дельтами метрик |

### Расчёт
| Метод | Путь | Назначение |
|---|---|---|
| `POST` | `/api/preview` | snapshot одного отсчёта для несохранённого draft, без Run |
| `POST` | `/api/runs` | запустить сутки: `{variant_id, routing_policy}`; заголовок `Idempotency-Key`. 202 — новый Run; 200 — переиспользован по `config_hash + engine_version` (ADR-011) или возвращён по ключу; 409 — тот же ключ с другим телом |
| `GET` | `/api/runs/{id}` | статус, стадия, прогресс |
| `GET` | `/api/runs/{id}/events` | SSE: `stage`, `completed_ticks`, `progress`, `status` |
| `POST` | `/api/runs/{id}/cancel` | отмена; 409 `RUN_NOT_CANCELLABLE` для завершённого Run |
| `GET` | `/api/runs/{id}/snapshot?t_s=` | состояние сети на отсчёте |
| `GET` | `/api/runs/{id}/timeline` | по клиентам: bitset доступности и причины по отсчётам |
| `GET` | `/api/runs/{id}/metrics` | ClientMetrics[] + ConfigMetrics |
| `GET` | `/api/runs/{id}/outages` | OutageInterval[] |
| `GET` | `/api/runs/{id}/backup-paths?t_s=&client_id=` | disjoint paths и минимальный разрез |
| `GET` | `/api/runs/{id}/export` | `cosmo-A-result-1.0` (+ `metrics`, `outages`, `engine_version`, `run_id`) |
| `GET` | `/api/runs/{id}/evidence-pack` | zip: экспорт, метрики, перерывы, сравнение, рекомендация |

### Сравнение и исследования
| Метод | Путь | Назначение |
|---|---|---|
| `POST` | `/api/comparisons` | `{run_ids: []}` → метрики рядом, дельты, изменённые параметры |
| `GET` | `/api/runs/{id}/recommendation?base_run_id=` | Recommendation |
| `POST` | `/api/experiments` | sweep: `{variant_id, axes: [{path, from, to, step}], budget: {max_points, max_seconds}, routing_policy}` |
| `GET` | `/api/experiments/{id}` | статус, прогресс, лучшие точки |
| `GET` | `/api/experiments/{id}/points` | точки heatmap с метриками |
| `POST` | `/api/experiments/{id}/points/{point_id}/materialize` | создать Variant из точки |
| `POST` | `/api/analysis/criticality` | `{run_id}` → Resilience X-Ray по каждому спутнику |

### Служебные
| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/api/health` | состояние api, postgres, redis, memgraph, minio, worker; флаг `degraded_mode` |
| `GET` | `/api/version` | `engine_version`, версия API |

## 3. Ошибки

```json
{ "error": { "code": "INVALID_SCENARIO_FIELD",
             "message": "Значение должно находиться в диапазоне [0, 360)",
             "path": "design.planes[2].raan_deg",
             "details": { "value": 420 } } }
```

Валидация возвращает **все** найденные ошибки списком `errors[]`, а не первую.
Порядок проверки сценария: сначала типы и обязательность полей (схема), затем диапазоны,
ссылки и интервалы в ядре; оба слоя отдают код и `path`. Ошибка query- или header-параметра
(`t_s`, `client_id`, `Idempotency-Key`) — тот же `INVALID_SCENARIO_FIELD` с `path` = имя
параметра: отдельного кода в глоссарии нет намеренно.
Коды — `03_GLOSSARY.md` §3.6. HTTP: 400 для ошибок входа, 404 для отсутствующих сущностей,
409 для `IDEMPOTENCY_KEY_CONFLICT` и `RUN_NOT_CANCELLABLE`, 422 для `EXPERIMENT_BUDGET_EXCEEDED`, 503 для
`STORAGE_UNAVAILABLE`.

## 4. Прогресс и idempotency

- Worker публикует прогресс в Redis-канал `run:{id}`; API транслирует его в SSE
  `/api/runs/{id}/events`. Polling `GET /api/runs/{id}` остаётся запасным путём.
- `Idempotency-Key` хранится в Redis с TTL 24 ч; повторный POST возвращает тот же Run.
  Под ключом хранится и отпечаток тела: тот же ключ с другой политикой или вариантом —
  409 `IDEMPOTENCY_KEY_CONFLICT`.
- Если Redis недоступен, расчёт выполняется в процессе api (degraded mode), ответ несёт
  заголовок `X-Degraded-Mode: true`; в сущность Run признак не входит.
- Готовый Run переиспользуется при совпадении `config_hash` и `engine_version` (ADR-011).
- Preview не создаёт Variant и Run; результат кэшируется в Redis на 1 ч по `config_hash + t_s`.

## 5. Экспорт

Обязательная часть — `01_SPEC.md` §8. Дополнительные поля: `metrics`, `outages`,
`engine_version`, `run_id`, `routing_policy`, `recommendation`. Экспортированный
`effective_scenario` проходит `POST /api/scenarios/validate` без ошибок: это тест.
