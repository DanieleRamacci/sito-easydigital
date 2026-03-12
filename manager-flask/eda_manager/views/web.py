from datetime import datetime

import jwt
from flask import Blueprint, current_app, make_response, redirect, render_template, request

from ..auth import require_admin, sanitize_next
from ..extensions import db
from ..models import DebtItem
from ..services.query import (
    JOB_STATUS_LABELS,
    add_payment,
    customers_query,
    dashboard_data,
    debt_rows_query,
    format_date_it,
    jobs_query,
    parse_date,
    parse_money,
    tickets_query,
    update_job_status,
    update_ticket_status,
)

bp = Blueprint("web", __name__)


@bp.app_context_processor
def inject_helpers():
    return {
        "fmt_date": format_date_it,
        "fmt_money": lambda x: f"€ {parse_money(x):,.2f}".replace(",", "X").replace(".", ",").replace("X", "."),
    }


@bp.get("/health")
def health():
    return {"ok": True, "app": "eda-manager-flask"}


@bp.get("/")
def home():
    return render_template("home.html", title=current_app.config["APP_TITLE"])


@bp.get("/gestionale/auth/callback")
def auth_callback():
    token = request.args.get("token", "").strip()
    next_path = sanitize_next(request.args.get("next"))
    if not token:
        return "Token mancante", 400
    try:
        jwt.decode(token, current_app.config["EDA_SSO_SECRET"], algorithms=["HS256"])
    except Exception:
        return "Token non valido", 401

    resp = make_response(redirect(next_path))
    resp.set_cookie(
        current_app.config["SESSION_COOKIE"],
        token,
        httponly=True,
        secure=current_app.config["COOKIE_SECURE"],
        samesite="Lax",
        path="/",
        max_age=60 * 60,
    )
    return resp


@bp.get("/logout")
def logout():
    resp = make_response(redirect("/"))
    resp.delete_cookie(current_app.config["SESSION_COOKIE"], path="/")
    return resp


@bp.get("/gestionale")
@require_admin
def dashboard():
    data = dashboard_data()
    return render_template(
        "dashboard.html",
        title=current_app.config["APP_TITLE"],
        kpi=data["kpi"],
        jobs=data["jobs"],
        debts=data["debts"],
        customers=data["customers"],
        tickets=data["tickets"],
    )


@bp.get("/gestionale/clienti")
@require_admin
def customers_page():
    q = request.args.get("q", "")
    status = request.args.get("status", "")
    rows = customers_query(q=q, status=status)
    return render_template("customers.html", title=current_app.config["APP_TITLE"], rows=rows, q=q, status=status)


@bp.get("/gestionale/clienti/table")
@require_admin
def customers_table():
    q = request.args.get("q", "")
    status = request.args.get("status", "")
    rows = customers_query(q=q, status=status)
    return render_template("partials/customers_table.html", rows=rows)


@bp.get("/gestionale/lavori")
@require_admin
def jobs_page():
    q = request.args.get("q", "")
    status = request.args.get("status", "")
    rows = jobs_query(q=q, status=status)
    return render_template(
        "jobs.html",
        title=current_app.config["APP_TITLE"],
        rows=rows,
        q=q,
        status=status,
        statuses=JOB_STATUS_LABELS,
    )


@bp.get("/gestionale/lavori/table")
@require_admin
def jobs_table():
    q = request.args.get("q", "")
    status = request.args.get("status", "")
    rows = jobs_query(q=q, status=status)
    return render_template("partials/jobs_table.html", rows=rows)


@bp.post("/gestionale/lavori/<int:job_id>/status")
@require_admin
def jobs_status_update(job_id: int):
    status = request.form.get("status", "")
    if status:
        update_job_status(job_id, status)
    if request.headers.get("HX-Request"):
        q = request.args.get("q", "")
        st = request.args.get("status", "")
        rows = jobs_query(q=q, status=st)
        return render_template("partials/jobs_table.html", rows=rows)
    return redirect("/gestionale/lavori")


@bp.get("/gestionale/debiti")
@require_admin
def debts_page():
    q = request.args.get("q", "")
    payment = request.args.get("payment", "")
    rows = debt_rows_query(q=q, payment=payment)
    return render_template("debts.html", title=current_app.config["APP_TITLE"], rows=rows, q=q, payment=payment)


@bp.get("/gestionale/debiti/table")
@require_admin
def debts_table():
    q = request.args.get("q", "")
    payment = request.args.get("payment", "")
    rows = debt_rows_query(q=q, payment=payment)
    return render_template("partials/debts_table.html", rows=rows)


@bp.post("/gestionale/debiti/<int:debt_id>/payments/new")
@require_admin
def debts_payment_new(debt_id: int):
    amount = parse_money(request.form.get("amount"))
    payment_date = parse_date(request.form.get("date"))
    note = (request.form.get("note") or "").strip()
    if amount > 0:
        add_payment(debt_id=debt_id, amount=amount, payment_date=payment_date, note=note)
    return redirect("/gestionale/debiti")


@bp.get("/gestionale/ticket")
@require_admin
def tickets_page():
    q = request.args.get("q", "")
    status = request.args.get("status", "")
    rows = tickets_query(q=q, status=status)
    return render_template("tickets.html", title=current_app.config["APP_TITLE"], rows=rows, q=q, status=status)


@bp.get("/gestionale/ticket/table")
@require_admin
def tickets_table():
    q = request.args.get("q", "")
    status = request.args.get("status", "")
    rows = tickets_query(q=q, status=status)
    return render_template("partials/tickets_table.html", rows=rows)


@bp.post("/gestionale/ticket/<int:ticket_id>/status")
@require_admin
def ticket_status_update(ticket_id: int):
    status = request.form.get("status", "")
    if status:
        update_ticket_status(ticket_id, status)
    return redirect("/gestionale/ticket")
