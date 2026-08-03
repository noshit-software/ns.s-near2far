from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health, setup, topics
from app.dashboard_stream import router as dashboard_stream_router
from app.db import create_pool
from app.logging import configure_logging

configure_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.db_pool = await create_pool()
    yield
    await app.state.db_pool.close()


app = FastAPI(title="near2far", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(topics.router)
app.include_router(setup.router)
app.include_router(dashboard_stream_router)
