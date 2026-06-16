from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import get_settings
from app.routers import admin as admin_router
from app.routers import admin_analytics as admin_analytics_router
from app.routers import auth as auth_router
from app.routers import chat as chat_router
from app.routers import exercise as exercise_router
from app.routers import meals as meals_router
from app.routers import points as points_router
from app.routers import rewards as rewards_router
from app.routers import survey as survey_router
from app.routers import telemetry as telemetry_router

settings = get_settings()

app = FastAPI(title="Cheddar API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

upload_path = Path(settings.upload_dir)
upload_path.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(upload_path)), name="uploads")

app.include_router(auth_router.router)
app.include_router(meals_router.router)
app.include_router(exercise_router.router)
app.include_router(chat_router.router)
app.include_router(points_router.router)
app.include_router(rewards_router.router)
app.include_router(survey_router.router)
app.include_router(telemetry_router.router)
app.include_router(admin_router.router)
app.include_router(admin_analytics_router.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
