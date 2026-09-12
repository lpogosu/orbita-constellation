# 10. Фикстуры и инварианты для тестов

| Статус | Обновлён | Заменяет | Назначение |
|---|---|---|---|
| Действует | 2026-09-11 | таблица из `04_calculation_core.md` | Golden-значения получены независимым пересчётом на официальном `geometry.py`. Менять только при доказанной ошибке в `geometry.py` и с новым ADR |

## 1. Golden-значения по четырём сценариям

Условия: `routing_policy = bfs_shortest`, клиенты не транзитные, 720 отсчётов.
Допуск на доли: `±0,0001`; на `max_gap_s`: точное совпадение.

| Сценарий | Клиент | `availability` | `visibility` | `max_gap_s` | `mean_hops` |
|---|---|---:|---:|---:|---:|
| `01_full_constellation` | C65 | 0,9667 | 0,9778 | 480 | 2,29 |
| | C70 | 0,9875 | 0,9986 | 120 | 2,66 |
| | C72 | 0,9889 | 1,0000 | 120 | 3,15 |
| `02_first_launch` | C65 | 0,2722 | 0,3819 | 34 320 | 2,07 |
| | C70 | 0,1583 | 0,4875 | 39 480 | 2,14 |
| | C72 | 0,1264 | 0,5847 | 47 760 | 3,12 |
| `03_satellite_outages` | C65 | 0,7931 | 0,8458 | 1 440 | 2,35 |
| | C70 | 0,8083 | 0,9028 | 1 440 | 2,77 |
| | C72 | 0,8250 | 0,9306 | 1 200 | 3,28 |
| `04_link_range` | C65 | 0,7750 | 0,9778 | 5 640 | 2,07 |
| | C70 | 0,6222 | 0,9986 | 10 680 | 2,38 |
| | C72 | 0,6514 | 1,0000 | 240 | 3,36 |

`mean_hops` считается по отсчётам с путём; допуск `±0,01`. Значение зависит от порядка
обхода соседей в BFS только через выбор одного из равных по длине путей, поэтому число
переходов минимального пути детерминировано, а конкретный путь — нет.

Производные значения для `01_full_constellation`:
`min_client_availability = 0,9667`, `worst_max_gap_s = 480`,
`target_met_clients = [C65, C70, C72]`.

## 2. Инварианты (property-тесты)

1. Для каждого экспортированного `path` каждое ребро существует в `G_t` того же отсчёта.
2. `path[0]` — клиент, `path[-1]` — доступный шлюз, все промежуточные узлы — активные
   спутники; ни один промежуточный узел не является клиентом.
3. Достижимость по BFS совпадает с Union-Find на каждом `(t, client)`.
4. `availability` при `persistent` равна `availability` при `bfs_shortest`.
5. `route_switches(persistent) ≤ route_switches(bfs_shortest)` для каждого клиента.
6. `hops(bfs_shortest) ≤ hops(dijkstra_distance)` на каждом отсчёте с путём.
7. `visibility ≥ availability` для каждого клиента.
8. Отказ спутника на весь горизонт не увеличивает `availability` ни одного клиента.
9. Число записей `routes` в экспорте = `total_ticks × число клиентов`, без дубликатов пар.
10. Экспортированный `effective_scenario` проходит валидацию без ошибок и при повторном
    запуске даёт идентичный экспорт (байт в байт после канонизации).
11. Отсчёт `t = horizon_s` не рассчитывается; отсчёт `t = 0` рассчитывается.
12. Отказ `[a; b)`: аппарат исключён из рёбер при `t = a`, включён при `t = b`.
13. Пересекающиеся отказы одного аппарата эквивалентны их объединению.
14. Недоступный аппарат присутствует в `satellites` snapshot с координатами и `active = false`.
15. `launch_stage = 1` даёт ровно спутники с `launch_batch = 1` активными.
16. При `min_elevation_deg = 89,999` (значение 90 запрещено `01_SPEC.md` §3.1) наземных
    рёбер нет; при `isl_range_km → 0` ISL нет.
17. Краевой перерыв помечен `truncated_by_horizon = true` тогда и только тогда, когда он
    содержит первый или последний отсчёт.
18. Сумма длительностей перерывов клиента = `(1 − availability) × horizon_s`.
19. `backup_path_count ≥ 1` на каждом отсчёте, где есть путь; `= 0`, где пути нет.
20. Скрытый сценарий: другие идентификаторы, 5 плоскостей по 7 спутников, 2 шлюза,
    4 клиента, отказ шлюза — расчёт завершается, экспорт валиден (ADR-015).

## 3. Негативные фикстуры для валидации

| Файл | Ожидаемый код | `path` |
|---|---|---|
| `bad_schema.json` | `UNSUPPORTED_SCHEMA_VERSION` | `schema_version` |
| `bad_step.json` (`step_s = 0`) | `INVALID_TIME_GRID` | `environment.step_s` |
| `bad_horizon.json` (`horizon_s % step_s ≠ 0`) | `INVALID_TIME_GRID` | `environment.horizon_s` |
| `bad_raan.json` (`raan_deg = 420`) | `INVALID_SCENARIO_FIELD` | `design.planes[1].raan_deg` |
| `dup_sat.json` | `DUPLICATE_NODE_ID` | `design.satellites[5].id` |
| `bad_plane_ref.json` | `UNRESOLVED_REFERENCE` | `design.satellites[0].plane_id` |
| `bad_failure_ref.json` | `UNRESOLVED_REFERENCE` | `failures[0].satellite_id` |
| `bad_interval.json` (`start_s ≥ end_s`) | `INVALID_OUTAGE_INTERVAL` | `failures[0]` |
| `no_gateway.json` | `MISSING_SITE_ROLE` | `ground_sites` |
| `nan_lat.json` | `INVALID_SCENARIO_FIELD` | `ground_sites[2].lat_deg` |
| `multi_errors.json` | список из трёх ошибок | по одной на каждую |

## 4. Команды проверки

```bash
# ядро
cd core && pytest -q --hypothesis-show-statistics
ruff check . && mypy --strict orbita_core

# сверка с официальным модулем на выборке отсчётов
python -m orbita_core crosscheck ../scenarios/01_full_constellation.json --ticks 0,120,43200,86280

# CLI и golden
python -m orbita_core run ../scenarios/01_full_constellation.json --out /tmp/r1.json
python -m orbita_core golden ../scenarios --fixtures docs/10_FIXTURES.md

# платформа
make up && make test && make demo
curl -s localhost:8000/api/health | jq .

# degraded-профиль
docker compose -f deploy/docker-compose.yml -f deploy/compose.degraded.yml up -d api
curl -s -X POST localhost:8000/api/runs -H 'Content-Type: application/json' -d '{"variant_id":"..."}'
```
