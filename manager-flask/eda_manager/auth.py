from functools import wraps
from typing import Any

import jwt
from flask import abort, current_app, g, make_response, redirect, request


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


def redirect_to_wp_login(next_path: str):
    wp_base = current_app.config.get("WP_BASE_URL", "")
    if not wp_base:
        abort(500, description="WP_BASE_URL non configurato")
    return redirect(f"{wp_base}/wp-json/eda-auth/v1/sso-start?next={next_path}")


def require_admin(view_fn):
    @wraps(view_fn)
    def wrapper(*args, **kwargs):
        cookie_name = current_app.config["SESSION_COOKIE"]
        token = request.cookies.get(cookie_name)
        if not token:
            return redirect_to_wp_login(sanitize_next(request.path))

        try:
            payload = jwt.decode(token, current_app.config["EDA_SSO_SECRET"], algorithms=["HS256"])
            g.user = payload
        except Exception:
            resp = make_response(redirect_to_wp_login(sanitize_next(request.path)))
            resp.delete_cookie(cookie_name, path="/")
            return resp

        if "administrator" not in _roles(g.user.get("roles")):
            abort(403, description="Area riservata amministratore")
        return view_fn(*args, **kwargs)

    return wrapper
