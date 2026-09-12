"""Предварительный просмотр: один отсчёт несохранённого черновика, без Variant и Run.

Нужен левой панели экрана «Сеть»: инженер двигает ползунок RAAN и сразу видит результат.
Заводить вариант и запуск на каждое движение ползунка нельзя — в проекте осталась бы
история из сотен мусорных конфигураций.

Считается ровно один отсчёт: contact plan строится на весь горизонт, потому что положение
аппаратов на отсчёте определяется сеткой времени целиком, а маршруты ищутся только на
запрошенном отсчёте (`orbita_core.routing.route_tick`). Результат кэшируется в Redis по
паре «конфигурация, отсчёт» (`05_API.md` §4): при недоступном Redis просмотр работает без
кэша, только медленнее.
"""

from __future__ import annotations

import asyncio

from orbita_core import contacts
from orbita_core.routing import RoutingPolicy as CoreRoutingPolicy
from orbita_core.routing import route_tick
from orbita_core.scenario import Scenario as CoreScenario

from orbita_api.runtime import RunRuntime
from orbita_api.schemas.runs import PreviewRequest, Snapshot
from orbita_api.services import results, scenarios


def _snapshot(scenario: CoreScenario, tick: int, policy: CoreRoutingPolicy) -> Snapshot:
    plan = contacts.build(scenario)
    return results.build_snapshot(scenario, plan, tick, route_tick(plan, tick, policy))


async def preview(runtime: RunRuntime, request: PreviewRequest) -> Snapshot:
    """Снимок одного отсчёта черновика: валидация ядром, расчёт отсчёта, кэш на час."""
    scenario = scenarios.parse(request.scenario)
    environment = scenario.environment
    tick = results.tick_of(request.t_s, environment.step_s, environment.horizon_s)
    config_hash = scenarios.run_config_hash(scenario, str(request.routing_policy))

    cached = await runtime.read_preview(config_hash, request.t_s)
    if cached is not None:
        return Snapshot.model_validate_json(cached)

    snapshot = await asyncio.to_thread(
        _snapshot,
        scenario,
        tick,
        CoreRoutingPolicy(str(request.routing_policy)),
    )
    await runtime.remember_preview(config_hash, request.t_s, snapshot.model_dump_json())
    return snapshot
