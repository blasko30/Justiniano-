import asyncio
from sqlalchemy import text
from app.core.database import engine

async def main():
    try:
        async with engine.connect() as conn:
            r = await conn.execute(text('SELECT 1'))
            print('DB OK', r.fetchall())
    except Exception as e:
        print('DB ERROR', repr(e))

if __name__ == '__main__':
    asyncio.run(main())
