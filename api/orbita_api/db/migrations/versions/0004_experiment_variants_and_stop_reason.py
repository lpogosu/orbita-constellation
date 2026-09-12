"""Link generated variants to experiments and retain stop reason."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "experiments", sa.Column("error", postgresql.JSONB(astext_type=sa.Text()), nullable=True)
    )
    op.add_column("variants", sa.Column("experiment_id", sa.Uuid(), nullable=True))
    op.create_index("ix_variants_experiment_id", "variants", ["experiment_id"])
    op.create_foreign_key(
        "fk_variants_experiment_id",
        "variants",
        "experiments",
        ["experiment_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_variants_experiment_id", "variants", type_="foreignkey")
    op.drop_index("ix_variants_experiment_id", table_name="variants")
    op.drop_column("variants", "experiment_id")
    op.drop_column("experiments", "error")
