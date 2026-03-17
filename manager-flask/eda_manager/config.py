import os
from pathlib import Path


class Config:
    BASE_DIR = Path(__file__).resolve().parents[1]
    DEFAULT_SQLITE = BASE_DIR / "data" / "manager.db"

    SECRET_KEY = os.getenv("SECRET_KEY", "change-me-in-production")

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

    # WordPress SSO (optional — leave empty to use only local login)
    WP_BASE_URL = (os.getenv("WP_BASE_URL", "") or "").rstrip("/")
    EDA_SSO_SECRET = os.getenv("EDA_SSO_SECRET", "change-me")

    # Session cookies
    SESSION_COOKIE = os.getenv("SESSION_COOKIE", "eda_mgr_session")
    SESSION_COOKIE_MAX_AGE = 8 * 60 * 60  # 8 hours
    COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
    PREFERRED_URL_SCHEME = "https" if COOKIE_SECURE else "http"

    # Flask built-in session (used for local admin login)
    SESSION_TYPE = "filesystem"
    PERMANENT_SESSION_LIFETIME = 8 * 60 * 60  # 8 hours

    # Data / import
    JSON_STORE_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR / "data")))
    JSON_STORE_FILE = JSON_STORE_DIR / "store.json"

    # Email (Flask-Mail) — supports both SMTP_* (production) and MAIL_* (legacy/dev) env vars
    MAIL_SERVER = os.getenv("SMTP_HOST") or os.getenv("MAIL_SERVER", "smtp.gmail.com")
    _mail_port = int(os.getenv("SMTP_PORT") or os.getenv("MAIL_PORT", "587"))
    MAIL_PORT = _mail_port
    # Port 465 = implicit SSL; 587/25 = STARTTLS
    MAIL_USE_SSL = _mail_port == 465 or os.getenv("MAIL_USE_SSL", "false").lower() == "true"
    MAIL_USE_TLS = (not MAIL_USE_SSL) and os.getenv("MAIL_USE_TLS", "true").lower() == "true"
    MAIL_USERNAME = os.getenv("SMTP_USER") or os.getenv("MAIL_USERNAME", "")
    MAIL_PASSWORD = os.getenv("SMTP_PASS") or os.getenv("MAIL_PASSWORD", "")
    MAIL_DEFAULT_SENDER = os.getenv("SMTP_FROM") or os.getenv("MAIL_DEFAULT_SENDER") or MAIL_USERNAME
    MAIL_SUPPRESS_SEND = os.getenv("MAIL_SUPPRESS_SEND", "false").lower() == "true"

    # Dev
    DEV_MODE = os.getenv("DEV_MODE", "false").lower() == "true"

    # App
    APP_TITLE = "EDA Manager"
    APP_BASE_URL = (os.getenv("APP_BASE_URL", "http://localhost:5051") or "").rstrip("/")
