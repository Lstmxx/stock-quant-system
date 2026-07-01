import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import health
from .routers.internal import router as internal_router
from .worker import start_worker
from .scheduler import start_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle: start worker and scheduler on startup, cancel on shutdown."""
    start_scheduler()
    task = asyncio.create_task(start_worker())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router, tags=["health"])
    app.include_router(internal_router)

    return app


app = create_app()
