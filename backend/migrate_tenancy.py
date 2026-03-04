import asyncio
import os
import uuid
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from sqlalchemy.pool import NullPool

# Load environment variables
load_dotenv(".env")
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    print("❌ ERROR: DATABASE_URL is not set in .env")
    exit(1)

# Ensure asyncpg prefix
if "postgresql://" in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")

def get_uuid() -> str:
    return str(uuid.uuid4()).replace("-", "_")

engine = create_async_engine(
    DATABASE_URL,
    connect_args={
        "statement_cache_size": 0,
        "prepared_statement_cache_size": 0,
        "prepared_statement_name_func": lambda: f"stmt_{get_uuid()}"
    },
    poolclass=NullPool
)

async def run_migration():
    print(f"🚀 Starting Multi-Tenant Migration on {DATABASE_URL.split('@')[1].split('/')[0]}...")
    
    heytea_id = str(uuid.uuid4())
    
    async with engine.begin() as conn:
        print("\n1️⃣ Creating `restaurants` table...")
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS restaurants (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(200) NOT NULL,
                created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
            );
        """))
        
        print(f"2️⃣ Provisioning default 'Heytea' tenant (ID: {heytea_id})...")
        await conn.execute(text("""
            INSERT INTO restaurants (id, name)
            VALUES (:id, :name)
            ON CONFLICT (id) DO NOTHING;
        """), {"id": heytea_id, "name": "Heytea"})
        
        tables_to_migrate = ["guests", "orders", "reviews", "intercept_actions", "sync_logs"]
        
        for table in tables_to_migrate:
            print(f"\n⚙️ Migrating `{table}`...")
            
            # Step A: Add column (nullable initially)
            print(f"  - Adding nullable `restaurant_id` column...")
            await conn.execute(text(f"""
                ALTER TABLE {table} 
                ADD COLUMN IF NOT EXISTS restaurant_id VARCHAR(36);
            """))
            
            # Step B: Populate existing rows with Heytea ID
            print(f"  - Linking existing records to Heytea...")
            await conn.execute(text(f"""
                UPDATE {table} SET restaurant_id = :heytea_id WHERE restaurant_id IS NULL;
            """), {"heytea_id": heytea_id})
            
            # Step C: Enforce NOT NULL and add Foreign Key constraint
            print(f"  - Enforcing NOT NULL and Foreign Key constraints...")
            await conn.execute(text(f"""
                ALTER TABLE {table} ALTER COLUMN restaurant_id SET NOT NULL;
            """))
            
            await conn.execute(text(f"""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint WHERE conname = 'fk_{table}_restaurant'
                    ) THEN
                        ALTER TABLE {table}
                        ADD CONSTRAINT fk_{table}_restaurant
                        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE;
                    END IF;
                END $$;
            """))
            
        print("\n✅ Multi-Tenant Migration Completed Successfully!")

if __name__ == "__main__":
    asyncio.run(run_migration())
