import asyncio
from app.worker import start_worker

async def test_run():
    print("Starting worker loop for 30 seconds...")
    try:
        await asyncio.wait_for(start_worker(), timeout=30)
    except asyncio.TimeoutError:
        print("Worker loop timed out as expected.")

if __name__ == "__main__":
    asyncio.run(test_run())
