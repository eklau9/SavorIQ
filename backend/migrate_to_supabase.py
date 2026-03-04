import asyncio
import sqlite3
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

# Import SavorIQ backend models & session maker
from app.database import async_session, init_db
from app.models import Guest, Order, Review, SentimentScore, InterceptAction, SyncLog

SQLITE_DB_PATH = "/Users/Ed/Desktop/savoriq.db"

def parse_date(date_str):
    if not date_str:
        return None
    # SQLite often stores dates like '2023-11-20 15:30:00' or '2023-11-20 15:30:00.123456'
    try:
        return datetime.fromisoformat(date_str)
    except Exception:
        # Fallback if fromisoformat fails
        if "." in date_str:
            return datetime.strptime(date_str, "%Y-%m-%d %H:%M:%S.%f")
        return datetime.strptime(date_str, "%Y-%m-%d %H:%M:%S")

async def migrate():
    # 1. Initialize Supabase tables
    print("Ensuring Supabase tables exist...")
    await init_db()

    # 2. Connect to SQLite
    print(f"Connecting to legacy SQLite DB at {SQLITE_DB_PATH}...")
    conn = sqlite3.connect(SQLITE_DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    async with async_session() as session:
        # 3. Clear existing Supabase data just to be safe (since it's empty anyway)
        # Using reversed order to respect foreign key constraints
        for model in [SentimentScore, InterceptAction, Order, Review, Guest, SyncLog]:
            await session.execute(text(f"TRUNCATE TABLE {model.__tablename__} CASCADE;"))
        await session.commit()
        print("Cleared any existing data in destination tables.")

        # --- MIGRATE GUESTS ---
        print("Migrating guests...")
        cursor.execute("SELECT * FROM guests")
        guests = cursor.fetchall()
        valid_guest_ids = set()
        for g in guests:
            valid_guest_ids.add(g["id"])
            new_guest = Guest(
                id=g["id"],
                name=g["name"],
                email=g["email"],
                phone=g["phone"],
                tier=g["tier"],
                first_visit=parse_date(g["first_visit"]),
                last_visit=parse_date(g["last_visit"]),
                created_at=parse_date(g["created_at"]) or datetime.utcnow()
            )
            session.add(new_guest)
        await session.commit()
        print(f"  -> Migrated {len(guests)} guests.")

        # --- MIGRATE ORDERS ---
        print("Migrating orders...")
        cursor.execute("SELECT * FROM orders")
        orders = cursor.fetchall()
        valid_orders = 0
        for o in orders:
            if o["guest_id"] not in valid_guest_ids:
                continue
            new_order = Order(
                id=o["id"],
                guest_id=o["guest_id"],
                item_name=o["item_name"],
                category=o["category"],
                price=o["price"],
                quantity=o["quantity"],
                ordered_at=parse_date(o["ordered_at"]) or datetime.utcnow()
            )
            session.add(new_order)
            valid_orders += 1
        await session.commit()
        print(f"  -> Migrated {valid_orders} orders.")

        # --- MIGRATE REVIEWS ---
        print("Migrating reviews...")
        cursor.execute("SELECT * FROM reviews")
        reviews = cursor.fetchall()
        valid_review_ids = set()
        valid_reviews_count = 0
        for r in reviews:
            if r["guest_id"] not in valid_guest_ids:
                continue
            valid_review_ids.add(r["id"])
            new_review = Review(
                id=r["id"],
                guest_id=r["guest_id"],
                platform=r["platform"],
                platform_review_id=r["platform_review_id"],
                rating=r["rating"],
                content=r["content"],
                reviewed_at=parse_date(r["reviewed_at"]) or datetime.utcnow(),
                ingested_at=parse_date(r["ingested_at"]) or datetime.utcnow()
            )
            session.add(new_review)
            valid_reviews_count += 1
        await session.commit()
        print(f"  -> Migrated {valid_reviews_count} reviews.")

        # --- MIGRATE SENTIMENT SCORES ---
        print("Migrating sentiment scores...")
        cursor.execute("SELECT * FROM sentiment_scores")
        scores = cursor.fetchall()
        valid_scores_count = 0
        for s in scores:
            if s["review_id"] not in valid_review_ids:
                continue
            new_score = SentimentScore(
                id=s["id"],
                review_id=s["review_id"],
                bucket=s["bucket"],
                score=s["score"],
                summary=s["summary"],
                analyzed_at=parse_date(s["analyzed_at"]) or datetime.utcnow()
            )
            session.add(new_score)
            valid_scores_count += 1
        await session.commit()
        print(f"  -> Migrated {valid_scores_count} sentiment scores.")

        # --- MIGRATE INTERCEPT ACTIONS ---
        print("Migrating intercept actions...")
        # Check if intercept_actions exists in SQLite
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='intercept_actions';")
        if cursor.fetchone():
            cursor.execute("SELECT * FROM intercept_actions")
            actions = cursor.fetchall()
            for a in actions:
                new_action = InterceptAction(
                    id=a["id"],
                    guest_id=a["guest_id"],
                    status=a["status"],
                    segment=a["segment"],
                    notes=a["notes"],
                    actioned_at=parse_date(a["actioned_at"]),
                    updated_at=parse_date(a["updated_at"])
                )
                session.add(new_action)
            await session.commit()
            print(f"  -> Migrated {len(actions)} intercept actions.")
        else:
            print("  -> Intercept actions table not found in SQLite. Skipping.")

        # --- MIGRATE SYNC LOGS ---
        print("Migrating sync logs...")
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_logs';")
        if cursor.fetchone():
            cursor.execute("SELECT * FROM sync_logs")
            logs = cursor.fetchall()
            for l in logs:
                new_log = SyncLog(
                    id=l["id"],
                    platform=l["platform"],
                    business_id=l["business_id"],
                    business_name=l["business_name"],
                    last_synced_at=parse_date(l["last_synced_at"]) or datetime.utcnow(),
                    reviews_fetched=l["reviews_fetched"],
                    new_reviews=l["new_reviews"]
                )
                session.add(new_log)
            await session.commit()
            print(f"  -> Migrated {len(logs)} sync logs.")
        else:
            print("  -> Sync logs table not found in SQLite. Skipping.")

    print("✅ Migration complete!")

if __name__ == "__main__":
    asyncio.run(migrate())
