"""Перезапуск упавших Run и обнуляемые метрики переходов.

Две правки, обе следуют из первого запуска очереди:

1. Уникальность `runs(config_hash, engine_version)` стала частичной. Полная уникальность
   запрещала перезапуск конфигурации, расчёт которой упал или был отменён: строка уже
   занимала пару, а переиспользовать (ADR-011) нечего. Теперь пару занимают только
   запуски в очереди, в работе и успешные.
2. `mean_hops`, `max_hops` и `backup_path_count_min` стали обнуляемыми. У клиента, ни
   разу не дотянувшегося до шлюза, переходов не существует, и ядро отдаёт `null`;
   контракт `05_API.md` §1 это допускает, а схема - нет.

Ревизия: 0002
Предыдущая: 0001
Создана: 2026-09-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INDEX_NAME = "uq_runs_config_hash_engine_version"

# Предикат повторяет `ACTIVE_RUN_PREDICATE` моделей буквально: миграция - снимок схемы и
# не зависит от того, как позже изменится код.
ACTIVE_RUN_PREDICATE = "status IN ('queued', 'running', 'succeeded')"

OPTIONAL_COLUMNS = (
    ("client_metrics", "mean_hops", sa.Float()),
    ("client_metrics", "max_hops", sa.Integer()),
    ("config_metrics", "mean_hops", sa.Float()),
    ("config_metrics", "max_hops", sa.Integer()),
    ("config_metrics", "backup_path_count_min", sa.Integer()),
)


def upgrade() -> None:
    op.drop_index(INDEX_NAME, table_name="runs")
    op.create_index(
        INDEX_NAME,
        "runs",
        ["config_hash", "engine_version"],
        unique=True,
        postgresql_where=sa.text(ACTIVE_RUN_PREDICATE),
    )
    for table, column, column_type in OPTIONAL_COLUMNS:
        op.alter_column(table, column, existing_type=column_type, nullable=True)


def downgrade() -> None:
    # Обратный переход возможен только на данных без `null` в метриках переходов и без
    # повторов пары «конфигурация, версия ядра»; иначе Postgres откажет, и это правильно.
    for table, column, column_type in OPTIONAL_COLUMNS:
        op.alter_column(table, column, existing_type=column_type, nullable=False)
    op.drop_index(INDEX_NAME, table_name="runs")
    op.create_index(INDEX_NAME, "runs", ["config_hash", "engine_version"], unique=True)
