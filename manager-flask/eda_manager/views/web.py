from datetime import datetime

import jwt
from flask import (
    Blueprint,
    current_app,
    flash,
    make_response,
    redirect,
    render_template,
    request,
    url_for,
)
from flask_mail import Message

from ..auth import hash_password, login_local_admin, logout_admin, require_admin, sanitize_next
from ..extensions import db, mail
from ..models import AdminUser, Customer, DebtItem, Invite, Notification, Service, Subscription
from ..services.query import (
    BILLING_INTERVAL_LABELS,
    JOB_STATUS_LABELS,
    add_payment,
    advance_renewal,
    create_invite,
    customer_detail_data,
    customers_query,
    dashboard_data,
    debt_rows_query,
    enum_value,
    format_date_it,
    get_all_services,
    get_invite_by_token,
    jobs_query,
    mark_notification_read,
    parse_date,
    parse_decimal,
    parse_money,
    process_renewals,
    renewals_query,
    subscriptions_query,
    tickets_query,
    update_job_status,
    update_ticket_status,
    upsert_debt_from_subscription,
)

bp = Blueprint("web", __name__)


# ---------------------------------------------------------------------------
# Template helpers
# ---------------------------------------------------------------------------

@bp.app_context_processor
def inject_helpers():
    def fmt_money(x):
        return f"€ {parse_money(x):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

    return {
        "fmt_date": format_date_it,
        "fmt_money": fmt_money,
        "JOB_STATUS_LABELS": JOB_STATUS_LABELS,
        "BILLING_INTERVAL_LABELS": BILLING_INTERVAL_LABELS,
    }


# ---------------------------------------------------------------------------
# Public
# ---------------------------------------------------------------------------

@bp.get("/health")
def health():
    return {"ok": True, "app": "eda-manager-flask"}


@bp.get("/")
def home():
    return render_template("home.html", title=current_app.config["APP_TITLE"])


# ---------------------------------------------------------------------------
# Auth — SSO callback + local login + logout
# ---------------------------------------------------------------------------

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
        max_age=current_app.config["SESSION_COOKIE_MAX_AGE"],
    )
    return resp


@bp.get("/gestionale/login")
def login_page():
    if request.args.get("next"):
        next_path = sanitize_next(request.args.get("next"))
    else:
        next_path = "/gestionale"
    return render_template("login.html", title=current_app.config["APP_TITLE"], next=next_path)


@bp.post("/gestionale/login")
def login_submit():
    email = (request.form.get("email") or "").strip()
    password = request.form.get("password") or ""
    next_path = sanitize_next(request.form.get("next"))

    if login_local_admin(email, password):
        return redirect(next_path)

    return render_template(
        "login.html",
        title=current_app.config["APP_TITLE"],
        next=next_path,
        error="Email o password non corretti.",
    )


@bp.get("/logout")
def logout():
    logout_admin()
    resp = make_response(redirect("/gestionale/login"))
    resp.delete_cookie(current_app.config["SESSION_COOKIE"], path="/")
    return resp


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

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
        notifications=data["notifications"],
        renewals_widget=data["renewals_widget"],
    )


@bp.post("/gestionale/notifications/<int:notif_id>/read")
@require_admin
def notification_read(notif_id: int):
    mark_notification_read(notif_id)
    return "", 204


# ---------------------------------------------------------------------------
# Clienti
# ---------------------------------------------------------------------------

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


@bp.get("/gestionale/clienti/<int:customer_id>")
@require_admin
def customer_detail(customer_id: int):
    data = customer_detail_data(customer_id)
    if not data:
        return "Cliente non trovato", 404
    services = get_all_services()
    return render_template(
        "customer_detail.html",
        title=current_app.config["APP_TITLE"],
        **data,
        services=services,
        JOB_STATUS_LABELS=JOB_STATUS_LABELS,
    )


@bp.post("/gestionale/clienti/<int:customer_id>/invita")
@require_admin
def customer_invite(customer_id: int):
    invite = create_invite(customer_id)
    if not invite:
        return "Cliente non trovato", 404
    base_url = current_app.config.get("APP_BASE_URL", "")
    invite_url = f"{base_url}/registrazione/{invite.token}"
    return render_template("partials/invite_link.html", invite_url=invite_url, customer_id=customer_id)


@bp.post("/gestionale/clienti/<int:customer_id>/email")
@require_admin
def customer_send_email(customer_id: int):
    customer = db.session.get(Customer, customer_id)
    if not customer:
        return "Cliente non trovato", 404

    subject = (request.form.get("subject") or "").strip()
    body = (request.form.get("body") or "").strip()
    if not subject or not body:
        return "Oggetto e testo obbligatori", 400

    try:
        msg = Message(
            subject=subject,
            recipients=[customer.email],
            body=body,
        )
        mail.send(msg)
        return render_template("partials/email_sent.html", customer=customer)
    except Exception as e:
        return f"Errore invio email: {e}", 500


# ---------------------------------------------------------------------------
# Lavori
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Debiti
# ---------------------------------------------------------------------------

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
    result = {}
    if amount > 0:
        result = add_payment(debt_id=debt_id, amount=amount, payment_date=payment_date, note=note)

    # Determine redirect: back to customer detail if referrer contains /clienti/
    ref = request.referrer or ""
    if "/gestionale/clienti/" in ref:
        return redirect(ref)
    return redirect("/gestionale/debiti")


# ---------------------------------------------------------------------------
# Abbonamenti
# ---------------------------------------------------------------------------

@bp.get("/gestionale/abbonamenti")
@require_admin
def subscriptions_page():
    status = request.args.get("status", "active")
    rows = subscriptions_query(status=status)
    return render_template(
        "subscriptions.html",
        title=current_app.config["APP_TITLE"],
        rows=rows,
        status=status,
    )


@bp.get("/gestionale/abbonamenti/table")
@require_admin
def subscriptions_table():
    status = request.args.get("status", "active")
    rows = subscriptions_query(status=status)
    return render_template("partials/subscriptions_table.html", rows=rows)


@bp.get("/gestionale/abbonamenti/nuovo")
@require_admin
def subscription_new_page():
    services = get_all_services()
    customers = customers_query(q="", status="active") + customers_query(q="", status="lead")
    preselect_customer = request.args.get("customer_id", "")
    return render_template(
        "subscription_form.html",
        title=current_app.config["APP_TITLE"],
        services=services,
        customers=customers,
        sub=None,
        preselect_customer=preselect_customer,
    )


@bp.post("/gestionale/abbonamenti/nuovo")
@require_admin
def subscription_new_submit():
    customer_id = int(request.form.get("customer_id") or 0)
    service_id = int(request.form.get("service_id") or 0)
    purchase_date = parse_date(request.form.get("purchase_date"))
    renewal_date = parse_date(request.form.get("renewal_date"))
    billing_type = request.form.get("billing_type", "subscription")
    billing_interval = request.form.get("billing_interval", "annual")
    price_at_sale = parse_decimal(request.form.get("price_at_sale") or 0)
    notes = (request.form.get("notes") or "").strip()
    job_id = request.form.get("job_id") or None
    create_debt = request.form.get("create_debt") == "1"

    if not customer_id or not service_id or not purchase_date:
        services = get_all_services()
        customers = customers_query(q="", status="active") + customers_query(q="", status="lead")
        return render_template(
            "subscription_form.html",
            title=current_app.config["APP_TITLE"],
            services=services,
            customers=customers,
            sub=None,
            error="Cliente, servizio e data acquisto sono obbligatori.",
        )

    sub = Subscription(
        customer_id=customer_id,
        service_id=service_id,
        job_id=int(job_id) if job_id else None,
        purchase_date=purchase_date,
        renewal_date=renewal_date,
        billing_type=billing_type,
        billing_interval=billing_interval,
        price_at_sale=price_at_sale,
        notes=notes,
        status="active",
    )
    db.session.add(sub)
    db.session.flush()  # get sub.id

    # Optionally create the first DebtItem
    if create_debt and billing_type == "subscription" and renewal_date:
        upsert_debt_from_subscription(sub)

    db.session.commit()
    return redirect(f"/gestionale/clienti/{customer_id}")


@bp.get("/gestionale/abbonamenti/<int:sub_id>/modifica")
@require_admin
def subscription_edit_page(sub_id: int):
    sub = db.session.get(Subscription, sub_id)
    if not sub:
        return "Abbonamento non trovato", 404
    services = get_all_services()
    customers = customers_query(q="", status="active") + customers_query(q="", status="lead")
    return render_template(
        "subscription_form.html",
        title=current_app.config["APP_TITLE"],
        services=services,
        customers=customers,
        sub=sub,
    )


@bp.post("/gestionale/abbonamenti/<int:sub_id>/modifica")
@require_admin
def subscription_edit_submit(sub_id: int):
    sub = db.session.get(Subscription, sub_id)
    if not sub:
        return "Abbonamento non trovato", 404

    sub.service_id = int(request.form.get("service_id") or sub.service_id)
    sub.purchase_date = parse_date(request.form.get("purchase_date")) or sub.purchase_date
    sub.renewal_date = parse_date(request.form.get("renewal_date")) or sub.renewal_date
    sub.billing_type = request.form.get("billing_type") or sub.billing_type
    sub.billing_interval = request.form.get("billing_interval") or sub.billing_interval
    sub.price_at_sale = parse_decimal(request.form.get("price_at_sale") or sub.price_at_sale)
    sub.notes = (request.form.get("notes") or "").strip()
    sub.status = request.form.get("status") or sub.status
    db.session.commit()
    return redirect(f"/gestionale/clienti/{sub.customer_id}")


@bp.post("/gestionale/abbonamenti/<int:sub_id>/cancella")
@require_admin
def subscription_cancel(sub_id: int):
    sub = db.session.get(Subscription, sub_id)
    if not sub:
        return "Abbonamento non trovato", 404
    customer_id = sub.customer_id
    sub.status = "cancelled"
    db.session.commit()
    return redirect(f"/gestionale/clienti/{customer_id}")


# ---------------------------------------------------------------------------
# Rinnovi
# ---------------------------------------------------------------------------

@bp.get("/gestionale/rinnovi")
@require_admin
def renewals_page():
    months = int(request.args.get("months", 3))
    rows = renewals_query(months_ahead=months)
    return render_template(
        "renewals.html",
        title=current_app.config["APP_TITLE"],
        rows=rows,
        months=months,
    )


@bp.get("/gestionale/rinnovi/table")
@require_admin
def renewals_table():
    months = int(request.args.get("months", 3))
    rows = renewals_query(months_ahead=months)
    return render_template("partials/renewals_table.html", rows=rows)


@bp.post("/gestionale/rinnovi/processa")
@require_admin
def renewals_process():
    created = process_renewals()
    return render_template("partials/renewals_processed.html", created=created)


# ---------------------------------------------------------------------------
# Ticket
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Registrazione cliente via invito
# ---------------------------------------------------------------------------

@bp.get("/registrazione/<token>")
def registration_page(token: str):
    invite = get_invite_by_token(token)
    if not invite:
        return render_template("registration_invalid.html", title="Link non valido")
    customer = db.session.get(Customer, invite.customer_id)
    return render_template(
        "registration.html",
        title="Completa la tua registrazione",
        invite=invite,
        customer=customer,
        token=token,
    )


@bp.post("/registrazione/<token>")
def registration_submit(token: str):
    invite = get_invite_by_token(token)
    if not invite:
        return render_template("registration_invalid.html", title="Link non valido")

    customer = db.session.get(Customer, invite.customer_id)
    if not customer:
        return "Errore interno", 500

    customer.company = (request.form.get("company") or customer.company).strip()
    customer.first_name = (request.form.get("first_name") or "").strip()
    customer.last_name = (request.form.get("last_name") or "").strip()
    customer.phone = (request.form.get("phone") or "").strip()
    customer.vat = (request.form.get("vat") or "").strip()
    customer.billing_address = (request.form.get("billing_address") or "").strip()
    customer.pec = (request.form.get("pec") or "").strip()
    customer.sdi = (request.form.get("sdi") or "").strip()
    customer.website = (request.form.get("website") or "").strip()
    customer.status = "active"

    invite.status = "completed"
    invite.completed_at = datetime.utcnow()
    db.session.commit()

    return render_template("registration_done.html", title="Registrazione completata", customer=customer)


# ---------------------------------------------------------------------------
# Admin setup (create first admin user — only if no admin exists)
# ---------------------------------------------------------------------------

@bp.get("/gestionale/setup")
def setup_page():
    if AdminUser.query.count() > 0:
        return redirect("/gestionale/login")
    return render_template("setup.html", title="Configurazione iniziale")


@bp.post("/gestionale/setup")
def setup_submit():
    if AdminUser.query.count() > 0:
        return redirect("/gestionale/login")
    name = (request.form.get("name") or "Admin").strip()
    email = (request.form.get("email") or "").strip().lower()
    password = request.form.get("password") or ""
    if not email or len(password) < 8:
        return render_template(
            "setup.html",
            title="Configurazione iniziale",
            error="Email valida e password di almeno 8 caratteri richiesti.",
        )
    admin = AdminUser(email=email, name=name, password_hash=hash_password(password))
    db.session.add(admin)
    db.session.commit()
    return redirect("/gestionale/login?setup=ok")
