"""Memgraph: проба доступности и хранилище временного графа (`06_STORAGE.md` §4).

Обязательный расчёт от Memgraph не зависит (ADR-009): здесь сохраняются результаты
расчёта, который уже выполнен в памяти ядра.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, Final
from uuid import UUID

from neo4j import AsyncDriver, AsyncGraphDatabase, AsyncSession
from orbita_core.contacts import ContactPlan

from orbita_api.adapters.storage import (
    ContactInterval,
    LineageEdge,
    contact_intervals,
    node_kinds,
)
from orbita_api.schemas import ServiceName

# Схема графа: по этим ключам идут все выборки, а уникальность пары не даёт задвоить узел
# при повторном сохранении того же запуска.
_SCHEMA_STATEMENTS: Final[tuple[str, ...]] = (
    "CREATE INDEX ON :Node(run_id)",
    "CREATE INDEX ON :Run(id)",
    "CREATE INDEX ON :Variant(project_id)",
    "CREATE CONSTRAINT ON (n:Node) ASSERT n.run_id, n.node_id IS UNIQUE",
    "CREATE CONSTRAINT ON (v:Variant) ASSERT v.id IS UNIQUE",
)

# Интервалов контактов за сутки — десятки тысяч. Один запрос на всё создавал бы
# транзакцию в сотни мегабайт, запрос на интервал — десятки тысяч сетевых обменов.
_BATCH_SIZE: Final[int] = 2_000


def _batched(
    items: Sequence[dict[str, Any]],
    size: int,
) -> list[Sequence[dict[str, Any]]]:
    return [items[start : start + size] for start in range(0, len(items), size)]


async def _execute(session: AsyncSession, query: str, parameters: dict[str, Any]) -> None:
    """Выполняет запись и дожидается её завершения.

    Результат нужно потребить: без `consume` ошибка запроса всплыла бы не здесь, а при
    закрытии сессии, и сбой записи графа выглядел бы как сбой в другом месте.
    """
    result = await session.run(query, parameters)
    await result.consume()


class MemgraphProbe:
    """Проверяет Bolt-соединение с Memgraph."""

    def __init__(self, url: str, user: str, password: str, timeout_s: float) -> None:
        self._driver = build_driver(url, user, password, timeout_s)

    @property
    def service(self) -> ServiceName:
        return ServiceName.MEMGRAPH

    async def ping(self) -> bool:
        await self._driver.verify_connectivity()
        return True

    async def aclose(self) -> None:
        await self._driver.close()


def build_driver(url: str, user: str, password: str, timeout_s: float) -> AsyncDriver:
    """Драйвер Bolt.

    Memgraph в compose поднимается без аутентификации: пустой логин означает, что
    драйверу не нужно передавать учётные данные вовсе.
    """
    auth = (user, password) if user else None
    return AsyncGraphDatabase.driver(
        url,
        auth=auth,
        connection_timeout=timeout_s,
        connection_acquisition_timeout=timeout_s,
    )


class MemgraphGraphStore:
    """Временной граф контактов и происхождение вариантов в Memgraph.

    Контакты хранятся интервалами `[start_tick; end_tick)`, а не ребром на каждый отсчёт:
    иначе сутки одной группировки дают сотни тысяч рёбер при том же содержании.
    """

    def __init__(self, driver: AsyncDriver) -> None:
        self._driver = driver
        self._schema_ready = False

    @property
    def persistent(self) -> bool:
        return True

    async def _ensure_schema(self) -> None:
        """Индексы и ограничения создаются при первом обращении.

        Повторный `CREATE INDEX` и повторный `CREATE CONSTRAINT` Memgraph принимает без
        ошибки, поэтому отдельная проверка существования не нужна. Внутри явной
        транзакции такие команды запрещены, поэтому они идут отдельными запросами.
        """
        if self._schema_ready:
            return
        async with self._driver.session() as session:
            for statement in _SCHEMA_STATEMENTS:
                await _execute(session, statement, {})
        self._schema_ready = True

    async def save_run_graph(
        self,
        run_id: UUID,
        engine_version: str,
        routing_policy: str,
        plan: ContactPlan,
        plane_ids: Mapping[str, str],
    ) -> None:
        """Записывает узлы и контакты запуска, заменяя прежнее содержимое.

        Сохранение начинается с удаления: повтор той же задачи после сбоя воркера иначе
        задвоил бы интервалы, ведь `CONTACT` создаётся по ребру на интервал и объединить
        их в `MERGE` по ключу нельзя.
        """
        await self._ensure_schema()
        await self.delete_run(run_id)

        kinds = node_kinds(plan)
        nodes = [
            {
                "node_id": node_id,
                "kind": str(kind),
                # Плоскость есть только у аппарата; у наземного пункта свойство пустое.
                "plane_id": plane_ids.get(node_id),
            }
            for node_id, kind in kinds.items()
        ]
        contacts = [
            {
                "source": interval.source,
                "target": interval.target,
                "start_tick": interval.start_tick,
                "end_tick": interval.end_tick,
                "min_distance_km": interval.min_distance_km,
                "max_distance_km": interval.max_distance_km,
            }
            for interval in contact_intervals(plan)
        ]

        async with self._driver.session() as session:
            await _execute(
                session,
                """
                MERGE (r:Run {id: $run_id})
                SET r.engine_version = $engine_version, r.routing_policy = $routing_policy
                """,
                {
                    "run_id": str(run_id),
                    "engine_version": engine_version,
                    "routing_policy": routing_policy,
                },
            )
            for batch in _batched(nodes, _BATCH_SIZE):
                await _execute(
                    session,
                    """
                    MATCH (r:Run {id: $run_id})
                    UNWIND $nodes AS item
                    CREATE (n:Node {
                        run_id: $run_id,
                        node_id: item.node_id,
                        kind: item.kind,
                        plane_id: item.plane_id
                    })
                    CREATE (r)-[:HAS_NODE]->(n)
                    """,
                    {"run_id": str(run_id), "nodes": list(batch)},
                )
            for batch in _batched(contacts, _BATCH_SIZE):
                await _execute(
                    session,
                    """
                    UNWIND $contacts AS item
                    MATCH (a:Node {run_id: $run_id, node_id: item.source})
                    MATCH (b:Node {run_id: $run_id, node_id: item.target})
                    CREATE (a)-[:CONTACT {
                        run_id: $run_id,
                        start_tick: item.start_tick,
                        end_tick: item.end_tick,
                        min_distance_km: item.min_distance_km,
                        max_distance_km: item.max_distance_km
                    }]->(b)
                    """,
                    {"run_id": str(run_id), "contacts": list(batch)},
                )

    async def save_variant_lineage(
        self,
        variant_id: UUID,
        project_id: UUID,
        title: str,
        config_hash: str,
        parent_variant_id: UUID | None,
        diff: Sequence[Mapping[str, Any]],
        deltas: Mapping[str, float],
    ) -> None:
        """Вариант и ребро `DERIVED_FROM` к родителю с дельтами метрик (ADR-011)."""
        await self._ensure_schema()
        async with self._driver.session() as session:
            await _execute(
                session,
                """
                MERGE (v:Variant {id: $variant_id})
                SET v.project_id = $project_id, v.title = $title, v.config_hash = $config_hash
                """,
                {
                    "variant_id": str(variant_id),
                    "project_id": str(project_id),
                    "title": title,
                    "config_hash": config_hash,
                },
            )
            if parent_variant_id is None:
                return
            await _execute(
                session,
                """
                MATCH (v:Variant {id: $variant_id})
                MERGE (p:Variant {id: $parent_id})
                MERGE (v)-[edge:DERIVED_FROM]->(p)
                SET edge.diff = $diff, edge += $deltas
                """,
                {
                    "variant_id": str(variant_id),
                    "parent_id": str(parent_variant_id),
                    "diff": [dict(change) for change in diff],
                    "deltas": dict(deltas),
                },
            )

    async def contacts_of(self, run_id: UUID, node_id: str) -> tuple[ContactInterval, ...]:
        """Контакты узла: направление ребра здесь не важно, важен сам факт линии.

        Первым в интервале всегда стоит запрошенный узел, поэтому вызывающему не нужно
        знать, как ядро упорядочило концы ребра.
        """
        async with self._driver.session() as session:
            result = await session.run(
                """
                MATCH (a:Node {run_id: $run_id, node_id: $node_id})
                      -[c:CONTACT]-(b:Node {run_id: $run_id})
                RETURN b.node_id AS peer,
                       c.start_tick AS start_tick,
                       c.end_tick AS end_tick,
                       c.min_distance_km AS min_distance_km,
                       c.max_distance_km AS max_distance_km
                ORDER BY start_tick, peer
                """,
                {"run_id": str(run_id), "node_id": node_id},
            )
            records = [record.data() async for record in result]
        return tuple(
            ContactInterval(
                source=node_id,
                target=str(record["peer"]),
                start_tick=int(record["start_tick"]),
                end_tick=int(record["end_tick"]),
                min_distance_km=float(record["min_distance_km"]),
                max_distance_km=float(record["max_distance_km"]),
            )
            for record in records
        )

    async def lineage(self, project_id: UUID) -> tuple[LineageEdge, ...]:
        """Дерево вариантов проекта: узлы без родителя тоже возвращаются."""
        async with self._driver.session() as session:
            result = await session.run(
                """
                MATCH (v:Variant {project_id: $project_id})
                OPTIONAL MATCH (v)-[edge:DERIVED_FROM]->(p:Variant)
                RETURN v.id AS variant_id,
                       v.title AS title,
                       v.config_hash AS config_hash,
                       p.id AS parent_variant_id,
                       edge AS edge
                ORDER BY variant_id
                """,
                {"project_id": str(project_id)},
            )
            records = [
                (record.data(), record["edge"]) async for record in result
            ]

        edges: list[LineageEdge] = []
        for data, edge in records:
            properties: dict[str, Any] = dict(edge) if edge is not None else {}
            diff = properties.pop("diff", []) or []
            parent = data["parent_variant_id"]
            edges.append(
                LineageEdge(
                    variant_id=UUID(str(data["variant_id"])),
                    parent_variant_id=UUID(str(parent)) if parent is not None else None,
                    title=str(data["title"]),
                    config_hash=str(data["config_hash"]),
                    diff=tuple(dict(change) for change in diff),
                    deltas={key: float(value) for key, value in properties.items()},
                ),
            )
        return tuple(edges)

    async def delete_run(self, run_id: UUID) -> None:
        """Удаляет запуск целиком: узлы вместе с их контактами."""
        async with self._driver.session() as session:
            await _execute(
                session,
                "MATCH (n:Node {run_id: $run_id}) DETACH DELETE n",
                {"run_id": str(run_id)},
            )
            await _execute(
                session,
                "MATCH (r:Run {id: $run_id}) DETACH DELETE r",
                {"run_id": str(run_id)},
            )

    async def ping(self) -> bool:
        await self._driver.verify_connectivity()
        return True

    async def aclose(self) -> None:
        await self._driver.close()
