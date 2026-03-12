import os
from pathlib import Path


class Config:
    BASE_DIR = Path(__file__).resolve().parents[1]
    DEFAULT_SQLITE = BASE_DIR / "data" / "manager.db"

    SECRET_KEY = os.getenv("SECRET_KEY", "change-me")
    _database_url = os.getenv("DATABASE_URL", f"sqlite:///{DEFAULT_SQLITE}")
    if _database_url.startswith("postgres://"):
        _database_url = _database_url.replace("postgres://", "postgresql+psycopg://", 1)
    elif _database_url.startswith("postgresql://"):
        _database_url = _database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    SQLALCHEMY_DATABASE_URI = _database_url
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_pre_ping": True,
        "pool_recycle": 300,
    }

    WP_BASE_URL = (os.getenv("WP_BASE_URL", "") or "").rstrip("/")
    EDA_SSO_SECRET = os.getenv("EDA_SSO_SECRET", "change-me")
    SESSION_COOKIE = os.getenv("SESSION_COOKIE", "eda_mgr_session")
    COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
    PREFERRED_URL_SCHEME = "https" if COOKIE_SECURE else "http"

    JSON_STORE_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR / "data")))
    JSON_STORE_FILE = JSON_STORE_DIR / "store.json"

    APP_TITLE = "Easy Digital Agency - Gestionale (Flask + HTMX + Postgres)"
