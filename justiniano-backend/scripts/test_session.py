import asyncio
from sqlalchemy import text
from app.core.database import SessionLocal

async def main():
    try:
        async with SessionLocal() as session:
            r = await session.execute(text('SELECT 1'))
            print('SESSION OK', r.fetchall())
    except Exception as e:
        print('SESSION ERROR', repr(e))

if __name__ == '__main__':
    asyncio.run(main())
