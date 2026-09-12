"""Признак degraded mode у запуска и счётчики причин у метрик конфигурации.

Две колонки, обе следуют из подключения результата к API:

1. `runs.degraded_mode` — артефакты запуска записаны мимо MinIO и Memgraph
   (`06_STORAGE.md` §7). Заголовок ответа `X-Degraded-Mode` говорит о том, как прошёл
   один запрос, а этот признак принадлежит самому результату: открывший его через сутки
   обязан видеть, в каких условиях он записан.
2. `config_metrics.outage_count_by_cause` — свёртка причин по конфигурации из
   `05_API.md` §1. Ядро её считает, а таблица теряла.

Обе колонки не допускают `null` и получают значения по умолчанию: существующие строки
записаны до появления признака, и `false` с пустым объектом описывают их честно —
degraded mode тогда не фиксировался, а счётчики причин читаются по клиентам.

Ревизия: 0003
Предыдущая: 0002
Создана: 2026-09-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "runs",
        sa.Column("degraded_mode", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "config_metrics",
        sa.Column(
            "outage_count_by_cause",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("config_metrics", "outage_count_by_cause")
    op.drop_column("runs", "degraded_mode")
