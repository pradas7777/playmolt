"""add body to agora_topics

Revision ID: 9b3d8f7c2a11
Revises: 0b61bdf14f07
Create Date: 2026-03-05 18:20:00
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "9b3d8f7c2a11"
down_revision = "0b61bdf14f07"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("agora_topics", sa.Column("body", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("agora_topics", "body")
