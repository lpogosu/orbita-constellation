"""Схема проектов, вариантов, запусков и метрик (`06_STORAGE.md` §3).

Значения enum перечислены здесь буквально, а не импортом из кода: миграция — снимок схемы
на момент её создания, и она обязана применяться одинаково независимо от того, как с тех
пор изменились перечисления приложения.

Ревизия: 0001
Предыдущая: None
Создана: 2026-09-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Длина строковых колонок; повторяет константы `orbita_api.db.models`.
ENUM_LENGTH = 32
NODE_ID_LENGTH = 64
HASH_LENGTH = 64
TITLE_LENGTH = 200
NAME_LENGTH = 200
URI_LENGTH = 500

# Цикл «проект ссылается на активный вариант, вариант ссылается на проект» разрывается
# отдельным ALTER после создания обеих таблиц.
ACTIVE_VARIANT_FK = "fk_projects_active_variant_id_variants"

ROUTING_POLICIES = ("bfs_shortest", "persistent", "dijkstra_distance")
RUN_STATUSES = ("queued", "running", "succeeded", "failed", "cancelled")
RUN_STAGES = ("validate", "geometry", "contacts", "routing", "analytics", "persist", "complete")
OUTAGE_CAUSES = (
    "NO_CLIENT_COVERAGE",
    "GATEWAY_OUTAGE",
    "NO_GATEWAY_COVERAGE",
    "NETWORK_PARTITION",
    "INTERNAL_INCONSISTENCY",
)


def enum_column(name: str, values: Sequence[str]) -> sa.Enum:
    """Строка с ограничением CHECK вместо отдельного типа Postgres.

    Имя таблицы к `name` добавляет соглашение об именах: ограничение колонки `status`
    таблицы `runs` называется `ck_runs_status`.
    """
    return sa.Enum(
        *values,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=ENUM_LENGTH,
    )


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=TITLE_LENGTH), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("active_variant_id", sa.Uuid(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_projects"),
    )
    op.create_table(
        "variants",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("parent_variant_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(length=TITLE_LENGTH), nullable=False),
        sa.Column("scenario", postgresql.JSONB(), nullable=False),
        sa.Column("diff_from_parent", postgresql.JSONB(), nullable=False),
        sa.Column("config_hash", sa.String(length=HASH_LENGTH), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        # Удаление проекта уносит все его варианты, а вместе с ними запуски и метрики
        # (`06_STORAGE.md` §6). Потомок варианта удаляется вместе с родителем: без
        # родителя его diff теряет смысл.
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name="fk_variants_project_id_projects",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["parent_variant_id"],
            ["variants.id"],
            name="fk_variants_parent_variant_id_variants",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_variants"),
    )
    op.create_index("ix_variants_project_id", "variants", ["project_id"])
    # Активный вариант обнуляется, а не удаляет проект: проект без вариантов допустим.
    op.create_foreign_key(
        ACTIVE_VARIANT_FK,
        "projects",
        "variants",
        ["active_variant_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_table(
        "runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("variant_id", sa.Uuid(), nullable=False),
        sa.Column(
            "routing_policy",
            enum_column("routing_policy", ROUTING_POLICIES),
            nullable=False,
        ),
        sa.Column("engine_version", sa.String(length=NAME_LENGTH), nullable=False),
        sa.Column("config_hash", sa.String(length=HASH_LENGTH), nullable=False),
        sa.Column("status", enum_column("status", RUN_STATUSES), nullable=False),
        sa.Column("stage", enum_column("stage", RUN_STAGES), nullable=False),
        sa.Column("progress", sa.Float(), nullable=False),
        sa.Column("completed_ticks", sa.Integer(), nullable=False),
        sa.Column("total_ticks", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("trace_uri", sa.String(length=URI_LENGTH), nullable=True),
        sa.Column("error", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["variant_id"],
            ["variants.id"],
            name="fk_runs_variant_id_variants",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_runs"),
    )
    op.create_index("ix_runs_variant_id", "runs", ["variant_id"])
    # Дедупликация ADR-011: пара «конфигурация, версия ядра» встречается не более раза.
    op.create_index(
        "uq_runs_config_hash_engine_version",
        "runs",
        ["config_hash", "engine_version"],
        unique=True,
    )

    op.create_table(
        "client_metrics",
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("client_id", sa.String(length=NODE_ID_LENGTH), nullable=False),
        sa.Column("availability", sa.Float(), nullable=False),
        sa.Column("visibility", sa.Float(), nullable=False),
        sa.Column("max_gap_s", sa.Integer(), nullable=False),
        sa.Column("mean_hops", sa.Float(), nullable=False),
        sa.Column("max_hops", sa.Integer(), nullable=False),
        sa.Column("route_switches", sa.Integer(), nullable=False),
        sa.Column("target_met", sa.Boolean(), nullable=False),
        sa.Column("outage_count_by_cause", postgresql.JSONB(), nullable=False),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["runs.id"],
            name="fk_client_metrics_run_id_runs",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("run_id", "client_id", name="pk_client_metrics"),
    )
    op.create_table(
        "config_metrics",
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("min_client_availability", sa.Float(), nullable=False),
        sa.Column("mean_client_availability", sa.Float(), nullable=False),
        sa.Column("worst_max_gap_s", sa.Integer(), nullable=False),
        sa.Column("mean_hops", sa.Float(), nullable=False),
        sa.Column("max_hops", sa.Integer(), nullable=False),
        sa.Column("route_switches_total", sa.Integer(), nullable=False),
        sa.Column("backup_path_count_min", sa.Integer(), nullable=False),
        sa.Column("target_met_clients", postgresql.JSONB(), nullable=False),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["runs.id"],
            name="fk_config_metrics_run_id_runs",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("run_id", name="pk_config_metrics"),
    )
    op.create_table(
        "outage_intervals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("client_id", sa.String(length=NODE_ID_LENGTH), nullable=False),
        sa.Column("start_s", sa.Integer(), nullable=False),
        sa.Column("end_s", sa.Integer(), nullable=False),
        sa.Column("truncated_by_horizon", sa.Boolean(), nullable=False),
        sa.Column(
            "primary_cause",
            enum_column("primary_cause", OUTAGE_CAUSES),
            nullable=False,
        ),
        sa.Column("causes", postgresql.JSONB(), nullable=False),
        sa.Column("evidence", postgresql.JSONB(), nullable=False),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["runs.id"],
            name="fk_outage_intervals_run_id_runs",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_outage_intervals"),
    )
    op.create_index(
        "ix_outage_intervals_run_id_client_id",
        "outage_intervals",
        ["run_id", "client_id"],
    )

    op.create_table(
        "experiments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("base_variant_id", sa.Uuid(), nullable=False),
        sa.Column("axes", postgresql.JSONB(), nullable=False),
        sa.Column("budget", postgresql.JSONB(), nullable=False),
        sa.Column(
            "routing_policy",
            enum_column("routing_policy", ROUTING_POLICIES),
            nullable=False,
        ),
        sa.Column("status", enum_column("status", RUN_STATUSES), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name="fk_experiments_project_id_projects",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["base_variant_id"],
            ["variants.id"],
            name="fk_experiments_base_variant_id_variants",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_experiments"),
    )
    op.create_index("ix_experiments_project_id", "experiments", ["project_id"])
    op.create_table(
        "experiment_points",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("experiment_id", sa.Uuid(), nullable=False),
        sa.Column("params", postgresql.JSONB(), nullable=False),
        sa.Column("config_hash", sa.String(length=HASH_LENGTH), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=True),
        sa.Column("min_client_availability", sa.Float(), nullable=True),
        sa.Column("worst_max_gap_s", sa.Integer(), nullable=True),
        sa.Column("mean_client_availability", sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(
            ["experiment_id"],
            ["experiments.id"],
            name="fk_experiment_points_experiment_id_experiments",
            ondelete="CASCADE",
        ),
        # Трасса точки sweep живёт 7 дней (`06_STORAGE.md` §6), сама точка — до удаления
        # эксперимента, поэтому удалённый запуск обнуляет ссылку, а не уносит точку.
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["runs.id"],
            name="fk_experiment_points_run_id_runs",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_experiment_points"),
    )
    op.create_index("ix_experiment_points_experiment_id", "experiment_points", ["experiment_id"])

    op.create_table(
        "recommendations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("base_run_id", sa.Uuid(), nullable=False),
        sa.Column("recommended_run_id", sa.Uuid(), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["base_run_id"],
            ["runs.id"],
            name="fk_recommendations_base_run_id_runs",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["recommended_run_id"],
            ["runs.id"],
            name="fk_recommendations_recommended_run_id_runs",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_recommendations"),
    )

    # Журнал задач без внешних ключей: задача может упасть до создания запуска, и её след
    # обязан сохраниться (`06_STORAGE.md` §3).
    op.create_table(
        "jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=NAME_LENGTH), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("status", enum_column("status", RUN_STATUSES), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column(
            "enqueued_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", postgresql.JSONB(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_jobs"),
    )

    op.create_table(
        "artifacts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=NAME_LENGTH), nullable=False),
        sa.Column("uri", sa.String(length=URI_LENGTH), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["runs.id"],
            name="fk_artifacts_run_id_runs",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_artifacts"),
    )
    op.create_index("ix_artifacts_run_id", "artifacts", ["run_id"])


def downgrade() -> None:
    op.drop_table("artifacts")
    op.drop_table("jobs")
    op.drop_table("recommendations")
    op.drop_table("experiment_points")
    op.drop_table("experiments")
    op.drop_table("outage_intervals")
    op.drop_table("config_metrics")
    op.drop_table("client_metrics")
    op.drop_table("runs")
    # Ключ снимается до удаления `variants`: иначе Postgres не даст удалить таблицу,
    # на которую он ссылается.
    op.drop_constraint(ACTIVE_VARIANT_FK, "projects", type_="foreignkey")
    op.drop_table("variants")
    op.drop_table("projects")
