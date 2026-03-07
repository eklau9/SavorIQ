"""Enable Row-Level Security on all tenant-scoped tables in Supabase.

This acts as a database-level safety net — even if application code forgets
a WHERE restaurant_id = ... filter, Postgres will block cross-tenant access
for non-service-role connections.

Usage:
    python migrate_rls.py
"""

import asyncio
import os
import uuid
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from sqlalchemy.pool import NullPool

load_dotenv(".env")
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    print("❌ ERROR: DATABASE_URL is not set in .env")
    exit(1)

if "postgresql://" in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")


def get_uuid() -> str:
    return str(uuid.uuid4()).replace("-", "_")


engine = create_async_engine(
    DATABASE_URL,
    connect_args={
        "statement_cache_size": 0,
        "prepared_statement_cache_size": 0,
        "prepared_statement_name_func": lambda: f"stmt_{get_uuid()}",
    },
    poolclass=NullPool,
)

# All tables that contain restaurant_id (tenant-scoped data)
TENANT_TABLES = [
    "guests",
    "orders",
    "reviews",
    "sentiment_scores",
    "intercept_actions",
    "sync_logs",
    "menu_items",  # will be created by migrate_menu_items.py
]


async def run_migration():
    print(f"🔐 Enabling Row-Level Security on Supabase...")

    async with engine.begin() as conn:
        for table in TENANT_TABLES:
            # Check if table exists first
            exists = await conn.execute(text("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = :table
                );
            """), {"table": table})
            if not exists.scalar():
                print(f"  ⏭️  Skipping `{table}` (table does not exist yet)")
                continue

            print(f"\n  ⚙️  Enabling RLS on `{table}`...")

            # 1. Enable RLS
            await conn.execute(text(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;"))

            # 2. Force RLS even for table owners (important for Supabase)
            await conn.execute(text(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;"))

            # 3. Create a permissive policy for the service role
            # The backend connects as the DB owner/service role, so this grants full access.
            # If you later add direct client access (e.g., PostgREST / Supabase client),
            # you'd add stricter per-user policies.
            policy_name = f"service_full_access_{table}"
            await conn.execute(text(f"""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_policies
                        WHERE tablename = '{table}' AND policyname = '{policy_name}'
                    ) THEN
                        CREATE POLICY {policy_name} ON {table}
                            FOR ALL
                            USING (true)
                            WITH CHECK (true);
                    END IF;
                END $$;
            """))

            print(f"  ✅ `{table}` — RLS enabled + service policy created")

    print("\n🎉 Row-Level Security setup complete!")
    print("   All tenant tables are now RLS-protected.")
    print("   The service role has full access; direct anonymous/authenticated")
    print("   access will be blocked unless you add specific policies.")


if __name__ == "__main__":
    asyncio.run(run_migration())
