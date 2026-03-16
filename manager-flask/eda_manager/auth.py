from functools import wraps
from typing import Any

import jwt
from flask import abort, current_app, g, make_response, redirect, request, session
from werkzeug.security import check_password_hash, generate_password_hash


def _roles(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(v) for v in value]
    if isinstance(value, str):
        return [value]
    return []


def sanitize_next(next_path: Any, fallback: str = "/gestionale") -> str:
    if not next_path:
        return fallback
    path = str(next_path)
    if path.startswith("/gestionale"):
        return path
    return fallback


def _try_jwt_auth() -> bool:
    """Try to authenticate via WordPress SSO JWT cookie. Returns True if successful."""
    cookie_name = current_app.config["SESSION_COOKIE"]
    token = request.cookies.get(cookie_name)
    if not token:
        return False
    try:
        payload = jwt.decode(token, current_app.config["EDA_SSO_SECRET"], algorithms=["HS256"])
        if "administrator" not in _roles(payload.get("roles")):
            return False
        g.user = payload
        g.auth_method = "sso"
        return True
    except Exception:
        return False


def _try_local_auth() -> bool:
    """Try to authenticate via local admin session. Returns True if successful."""
    admin_id = session.get("admin_id")
    if not admin_id:
        return False
    from .models import AdminUser
    admin = AdminUser.query.get(admin_id)
    if not admin:
        session.pop("admin_id", None)
        return False
    g.user = {"id": admin.id, "email": admin.email, "name": admin.name, "roles": ["administrator"]}
    g.auth_method = "local"
    return True


def require_admin(view_fn):
    @wraps(view_fn)
    def wrapper(*args, **kwargs):
        # 1. Try local session first (fastest, no crypto)
        if _try_local_auth():
            return view_fn(*args, **kwargs)

        # 2. Try JWT cookie (WordPress SSO)
        if _try_jwt_auth():
            return view_fn(*args, **kwargs)

        # 3. Redirect to local login page
        next_path = sanitize_next(request.path)
        return redirect(f"/gestionale/login?next={next_path}")

    return wrapper


def login_local_admin(email: str, password: str) -> bool:
    """Verify credentials and set session. Returns True on success."""
    from .models import AdminUser
    admin = AdminUser.query.filter(AdminUser.email == email.lower().strip()).first()
    if not admin:
        return False
    if not check_password_hash(admin.password_hash, password):
        return False
    session.permanent = True
    session["admin_id"] = admin.id
    return True


def logout_admin() -> None:
    session.pop("admin_id", None)


def hash_password(password: str) -> str:
    return generate_password_hash(password)
