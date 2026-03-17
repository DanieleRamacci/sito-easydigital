from datetime import datetime

import jwt
from flask import (
    Blueprint,
    current_app,
    make_response,
    redirect,
    render_template,
    request,
)
from flask_mail import Message

from ..auth import require_admin, require_customer, sanitize_next
from ..extensions import db, mail
from ..models import Customer, DebtItem, Invite, Job, Notification, Service, Subscription
from ..services.query import (
    BILLING_INTERVAL_LABELS,
    JOB_STATUS_LABELS,
    add_customer_note,
    add_job_note,
    add_payment,
    advance_renewal,
    create_customer,
    create_invite,
    create_job,
    create_service,
    create_ticket,
    customer_area_data,
    customer_detail_data,
    customers_query,
    dashboard_data,
    debt_rows_query,
    delete_customer,
    delete_job,
    enum_value,
    format_date_it,
    get_all_services,
    get_invite_by_token,
    job_detail_data,
    jobs_query,
    mark_notification_read,
    parse_date,
    parse_decimal,
    parse_money,
    process_renewals,
    register_wp_user,
    renewals_query,
    services_query,
    subscriptions_query,
    tickets_query,
    toggle_job_payment,
    update_customer,
    update_job,
    update_job_note,
    update_job_status,
    update_service_price,
    update_ticket_status,
    upsert_debt_from_subscription,
)

bp = Blueprint("web", __name__)


def _mail_send(msg, timeout: int = 10):
    """Send mail with a socket timeout to prevent gunicorn worker hangs.
    Flask-Mail 0.10 does not pass a timeout to smtplib; without this the
    SMTP TCP connect can block for 60–120 s and trigger a gunicorn WORKER TIMEOUT.
    """
    import socket
    old = socket.getdefaulttimeout()
    socket.setdefaulttimeout(timeout)
    try:
        mail.send(msg)
    finally:
        socket.setdefaulttimeout(old)


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


@bp.get("/dev-login")
def dev_login():
    """Dev-only: generate a local JWT and set the session cookie (DEV_MODE=true required)."""
    if not current_app.config.get("DEV_MODE"):
        return "Not available", 404
    import time
    role = request.args.get("role", "administrator")
    payload = {
        "sub": "1",
        "email": "dev@local.test",
        "roles": [role],
        "iat": int(time.time()),
        "exp": int(time.time()) + 8 * 3600,
    }
    token = jwt.encode(payload, current_app.config["EDA_SSO_SECRET"], algorithm="HS256")
    default_next = "/gestionale" if role == "administrator" else "/areapersonale"
    next_path = sanitize_next(request.args.get("next"), fallback=default_next)
    resp = make_response(redirect(next_path))
    resp.set_cookie(
        current_app.config["SESSION_COOKIE"],
        token,
        httponly=True,
        secure=False,
        samesite="Lax",
        path="/",
        max_age=8 * 3600,
    )
    return resp


@bp.get("/")
def home():
    return render_template("home.html", title=current_app.config["APP_TITLE"])


# ---------------------------------------------------------------------------
# Auth — SSO callback (WordPress) + logout
# ---------------------------------------------------------------------------

@bp.get("/gestionale/auth/callback")
@bp.get("/areapersonale/auth/callback")
def auth_callback():
    """Receives the JWT token from WordPress SSO and sets the session cookie."""
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


@bp.get("/logout")
def logout():
    resp = make_response(redirect("/"))
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


@bp.get("/gestionale/clienti/<int:customer_id>/anteprima-area")
@require_admin
def customer_area_preview(customer_id: int):
    """Admin preview: renders the customer's personal area as they would see it."""
    from ..models import Customer as _C
    customer = db.session.get(_C, customer_id)
    if not customer:
        return "Cliente non trovato", 404
    from ..services.query import customer_area_data
    data = customer_area_data(customer.wp_user_id or 0, customer.email) or {}
    return render_template(
        "areapersonale.html",
        title=f"Anteprima area personale — {customer.company or customer.email}",
        customer=data.get("customer"),
        subscriptions=data.get("subscriptions", []),
        open_debts=data.get("open_debts", []),
        upcoming_renewals=data.get("upcoming_renewals", []),
        user={"email": customer.email},
        is_admin_preview=True,
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
        _mail_send(msg)
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
        import re
        m = re.search(r"/gestionale/clienti/(\d+)", ref)
        if m:
            return redirect(f"/gestionale/clienti/{m.group(1)}#sec-debiti")
    return redirect("/gestionale/debiti")


@bp.post("/gestionale/debiti/<int:debt_id>/sollecito")
@require_admin
def debt_sollecito(debt_id: int):
    debt = db.session.get(DebtItem, debt_id)
    if not debt:
        return render_template("partials/notify_result.html", error="Debito non trovato")

    customer = db.session.get(Customer, debt.customer_id)
    if not customer or not customer.email:
        return render_template("partials/notify_result.html", error="Cliente senza indirizzo email")

    from ..services.query import debt_outstanding, parse_decimal
    outstanding = debt_outstanding(debt.amount_total, debt.amount_paid)
    # Pass a plain dict to avoid SQLAlchemy ORM recursion in Jinja2 (lazy="dynamic" relationships)
    debt_data = {
        "label": debt.label,
        "due_date": debt.due_date,
        "amount_total": parse_decimal(debt.amount_total),
        "amount_paid": parse_decimal(debt.amount_paid),
    }

    subject = f"Sollecito pagamento: {debt.label}"
    body_html = render_template(
        "email/debt_sollecito.html",
        customer=customer,
        debt=debt_data,
        outstanding=outstanding,
    )

    try:
        sender = (
            current_app.config.get("MAIL_DEFAULT_SENDER")
            or current_app.config.get("MAIL_USERNAME")
            or "noreply@easydigitalagency.it"
        )
        msg = Message(subject=subject, sender=sender, recipients=[customer.email], html=body_html)
        _mail_send(msg)
        suppressed = current_app.config.get("MAIL_SUPPRESS_SEND", False)
        return render_template("partials/notify_result.html", success=True, email=customer.email, suppressed=suppressed)
    except Exception as e:
        return render_template("partials/notify_result.html", error=str(e))


@bp.post("/gestionale/clienti/<int:customer_id>/riepilogo-email")
@require_admin
def customer_summary_email(customer_id: int):
    customer = db.session.get(Customer, customer_id)
    if not customer or not customer.email:
        return render_template("partials/notify_result.html", error="Cliente senza indirizzo email")

    from ..services.query import customer_detail_data, renewals_query, parse_decimal, debt_outstanding
    data = customer_detail_data(customer_id)
    if not data:
        return render_template("partials/notify_result.html", error="Cliente non trovato")

    # Upcoming renewals for this customer only
    all_renewals = renewals_query(payment="pending")
    upcoming_renewals = [r for r in all_renewals if r["customer_id"] == customer_id]

    subject = f"Riepilogo account — {customer.company or customer.email}"
    body_html = render_template(
        "email/customer_summary.html",
        customer=customer,
        open_debts=data["open_debts"],
        total_outstanding=data["total_outstanding"],
        upcoming_renewals=upcoming_renewals,
        app_base_url=current_app.config.get("APP_BASE_URL", ""),
    )

    try:
        sender = (
            current_app.config.get("MAIL_DEFAULT_SENDER")
            or current_app.config.get("MAIL_USERNAME")
            or "noreply@easydigitalagency.it"
        )
        msg = Message(subject=subject, sender=sender, recipients=[customer.email], html=body_html)
        _mail_send(msg)
        suppressed = current_app.config.get("MAIL_SUPPRESS_SEND", False)
        return render_template("partials/notify_result.html", success=True, email=customer.email, suppressed=suppressed)
    except Exception as e:
        return render_template("partials/notify_result.html", error=str(e))


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
    return redirect(f"/gestionale/clienti/{sub.customer_id}#sec-abbonamenti")


@bp.post("/gestionale/abbonamenti/<int:sub_id>/cancella")
@require_admin
def subscription_cancel(sub_id: int):
    sub = db.session.get(Subscription, sub_id)
    if not sub:
        return "Abbonamento non trovato", 404
    customer_id = sub.customer_id
    sub.status = "cancelled"
    db.session.commit()
    return redirect(f"/gestionale/clienti/{customer_id}#sec-abbonamenti")


# ---------------------------------------------------------------------------
# Rinnovi
# ---------------------------------------------------------------------------

@bp.get("/gestionale/rinnovi")
@require_admin
def renewals_page():
    payment = request.args.get("payment", "pending")
    rows = renewals_query(payment=payment)
    return render_template(
        "renewals.html",
        title=current_app.config["APP_TITLE"],
        rows=rows,
        payment=payment,
    )


@bp.get("/gestionale/rinnovi/table")
@require_admin
def renewals_table():
    payment = request.args.get("payment", "pending")
    rows = renewals_query(payment=payment)
    return render_template("partials/renewals_table.html", rows=rows)


@bp.post("/gestionale/rinnovi/processa")
@require_admin
def renewals_process():
    created = process_renewals()
    return render_template("partials/renewals_processed.html", created=created)


@bp.post("/gestionale/rinnovi/<int:sub_id>/paga")
@require_admin
def renewal_pay(sub_id: int):
    from datetime import date as _date
    sub = db.session.get(Subscription, sub_id)
    if not sub:
        rows = renewals_query(payment="pending")
        return render_template("partials/renewals_table.html", rows=rows, flash_error="Abbonamento non trovato")

    from ..services.query import upsert_debt_from_subscription
    debt = upsert_debt_from_subscription(sub)
    db.session.flush()

    if debt is None:
        rows = renewals_query(payment="pending")
        return render_template("partials/renewals_table.html", rows=rows, flash_error="Nessun debito generabile")

    result = add_payment(
        debt_id=debt.id,
        amount=float(debt.amount_total),
        payment_date=_date.today(),
    )
    if "error" in result:
        rows = renewals_query(payment="pending")
        return render_template("partials/renewals_table.html", rows=rows, flash_error=result["error"])

    next_url = request.args.get("next") or request.form.get("next")
    if next_url:
        from urllib.parse import urlparse
        # Only allow relative redirects for safety
        parsed = urlparse(next_url)
        if not parsed.netloc:
            from flask import redirect
            return redirect(next_url)

    rows = renewals_query(payment="pending")
    return render_template("partials/renewals_table.html", rows=rows)


@bp.post("/gestionale/rinnovi/<int:sub_id>/notifica")
@require_admin
def renewal_notify(sub_id: int):
    sub = db.session.get(Subscription, sub_id)
    if not sub:
        return render_template("partials/notify_result.html", error="Abbonamento non trovato")

    customer = db.session.get(Customer, sub.customer_id)
    if not customer or not customer.email:
        return render_template("partials/notify_result.html", error="Cliente senza indirizzo email")

    service = db.session.get(Service, sub.service_id)
    service_name = service.name if service else "-"

    from ..services.query import BILLING_INTERVAL_LABELS, enum_value, parse_decimal
    interval_label = BILLING_INTERVAL_LABELS.get(enum_value(sub.billing_interval), "-")

    subject = f"Promemoria rinnovo: {service_name}"
    body_html = render_template(
        "email/renewal_reminder.html",
        customer=customer,
        service_name=service_name,
        renewal_date=sub.renewal_date,
        price=parse_decimal(sub.price_at_sale),
        interval_label=interval_label,
        app_base_url=current_app.config.get("APP_BASE_URL", ""),
    )

    try:
        sender = (
            current_app.config.get("MAIL_DEFAULT_SENDER")
            or current_app.config.get("MAIL_USERNAME")
            or "noreply@easydigitalagency.it"
        )
        msg = Message(
            subject=subject,
            sender=sender,
            recipients=[customer.email],
            html=body_html,
        )
        _mail_send(msg)
        suppressed = current_app.config.get("MAIL_SUPPRESS_SEND", False)
        return render_template("partials/notify_result.html", success=True, email=customer.email, suppressed=suppressed)
    except Exception as e:
        return render_template("partials/notify_result.html", error=str(e))


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
# Registrazione cliente via invito (areapersonale/invito — same path as server.js)
# ---------------------------------------------------------------------------

@bp.get("/areapersonale/invito")
def registration_page():
    token = request.args.get("token", "").strip()
    msg = request.args.get("msg", "")
    if not token:
        return render_template("registration_invalid.html", title="Link non valido")
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
        msg=msg,
    )


@bp.post("/areapersonale/invito")
def registration_submit():
    token = (request.form.get("token") or "").strip()
    invite = get_invite_by_token(token)
    if not invite:
        return render_template("registration_invalid.html", title="Link non valido")

    customer = db.session.get(Customer, invite.customer_id)
    if not customer:
        return "Errore interno", 500

    password = (request.form.get("password") or "").strip()
    if not password:
        return render_template(
            "registration.html",
            title="Completa la tua registrazione",
            invite=invite,
            customer=customer,
            token=token,
            msg="La password è obbligatoria.",
        )

    # Update customer data from form
    customer.company = (request.form.get("company") or customer.company or "").strip()
    customer.first_name = (request.form.get("first_name") or "").strip()
    customer.last_name = (request.form.get("last_name") or "").strip()
    customer.phone = (request.form.get("phone") or "").strip()
    customer.vat = (request.form.get("vat") or "").strip()
    customer.billing_address = (request.form.get("billing_address") or "").strip()
    customer.pec = (request.form.get("pec") or "").strip()
    customer.sdi = (request.form.get("sdi") or "").strip()
    customer.website = (request.form.get("website") or "").strip()

    # Register user on WordPress via eda-auth plugin
    wp_base = current_app.config.get("WP_BASE_URL", "")
    if not wp_base:
        return "WP_BASE_URL non configurato", 500

    display_name = f"{customer.first_name} {customer.last_name}".strip() or customer.company or customer.email
    ok, data = register_wp_user(wp_base, customer.email, display_name, password)
    if not ok:
        error_msg = data.get("message", "Errore durante la registrazione su WordPress.")
        return render_template(
            "registration.html",
            title="Completa la tua registrazione",
            invite=invite,
            customer=customer,
            token=token,
            msg=error_msg,
        )

    # Save wp_user_id and complete invite
    customer.wp_user_id = int(data.get("user_id") or 0) or None
    customer.status = "active"
    invite.status = "completed"
    invite.completed_at = datetime.utcnow()
    db.session.commit()

    wp_login_url = f"{wp_base}/wp-json/eda-auth/v1/sso-start?next=/areapersonale"
    return render_template(
        "registration_done.html",
        title="Registrazione completata",
        customer=customer,
        wp_login_url=wp_login_url,
    )


# ---------------------------------------------------------------------------
# Area personale cliente (richiede qualsiasi JWT WordPress valido)
# ---------------------------------------------------------------------------

@bp.get("/areapersonale")
@require_customer
def areapersonale():
    from flask import g
    wp_user_id = int(g.user.get("sub") or 0)
    user_email = str(g.user.get("email") or "").lower()
    data = customer_area_data(wp_user_id, user_email) or {}
    return render_template(
        "areapersonale.html",
        title="La tua area personale",
        customer=data.get("customer"),
        subscriptions=data.get("subscriptions", []),
        open_debts=data.get("open_debts", []),
        upcoming_renewals=data.get("upcoming_renewals", []),
        user=g.user,
    )


# Keep legacy /registrazione/<token> redirect for backwards compatibility
@bp.get("/registrazione/<token>")
def registration_legacy_redirect(token: str):
    return redirect(f"/areapersonale/invito?token={token}")


# ---------------------------------------------------------------------------
# Clienti — CRUD
# ---------------------------------------------------------------------------

@bp.get("/gestionale/clienti/nuovo")
@require_admin
def customer_new_page():
    return render_template(
        "customer_form.html",
        title=current_app.config["APP_TITLE"],
        customer=None,
    )


@bp.post("/gestionale/clienti/nuovo")
@require_admin
def customer_new_submit():
    company = (request.form.get("company") or "").strip()
    email = (request.form.get("email") or "").strip().lower()
    if not company or not email:
        return render_template(
            "customer_form.html",
            title=current_app.config["APP_TITLE"],
            customer=None,
            error="Azienda e email sono obbligatori.",
        )
    try:
        customer = create_customer(request.form)
    except Exception as exc:
        db.session.rollback()
        import traceback
        traceback.print_exc()
        from sqlalchemy.exc import IntegrityError
        if isinstance(exc, IntegrityError) and "unique" in str(exc).lower():
            error_msg = "Email già presente nel sistema."
        else:
            error_msg = f"Errore: {type(exc).__name__}: {exc}"
        return render_template(
            "customer_form.html",
            title=current_app.config["APP_TITLE"],
            customer=None,
            error=error_msg,
        )
    return redirect(f"/gestionale/clienti/{customer.id}")


@bp.post("/gestionale/clienti/<int:customer_id>/modifica")
@require_admin
def customer_edit_submit(customer_id: int):
    updated = update_customer(customer_id, request.form)
    if not updated:
        return "Cliente non trovato", 404
    return redirect(f"/gestionale/clienti/{customer_id}#sec-modifica")


@bp.post("/gestionale/clienti/<int:customer_id>/elimina")
@require_admin
def customer_delete(customer_id: int):
    ok = delete_customer(customer_id)
    if not ok:
        return "Cliente non trovato", 404
    return redirect("/gestionale/clienti")


@bp.post("/gestionale/clienti/<int:customer_id>/note")
@require_admin
def customer_note_add(customer_id: int):
    text = (request.form.get("text") or "").strip()
    if text:
        add_customer_note(customer_id, text)
    return redirect(f"/gestionale/clienti/{customer_id}#sec-note")


# ---------------------------------------------------------------------------
# Lavori — CRUD + Detail
# ---------------------------------------------------------------------------

@bp.get("/gestionale/lavori/nuovo")
@require_admin
def job_new_page():
    services = get_all_services()
    all_customers = customers_query(q="", status="")
    preselect = request.args.get("customer_id", "")
    return render_template(
        "job_form.html",
        title=current_app.config["APP_TITLE"],
        job=None,
        services=services,
        customers=all_customers,
        statuses=JOB_STATUS_LABELS,
        preselect_customer=preselect,
    )


@bp.post("/gestionale/lavori/nuovo")
@require_admin
def job_new_submit():
    title = (request.form.get("title") or "").strip()
    customer_id = int(request.form.get("customer_id") or 0)
    if not title or not customer_id:
        services = get_all_services()
        all_customers = customers_query(q="", status="")
        return render_template(
            "job_form.html",
            title=current_app.config["APP_TITLE"],
            job=None,
            services=services,
            customers=all_customers,
            statuses=JOB_STATUS_LABELS,
            preselect_customer="",
            error="Titolo e cliente sono obbligatori.",
        )
    job = create_job(request.form)
    return redirect(f"/gestionale/lavori/{job.id}")


@bp.get("/gestionale/lavori/<int:job_id>")
@require_admin
def job_detail_page(job_id: int):
    data = job_detail_data(job_id)
    if not data:
        return "Lavoro non trovato", 404
    services = get_all_services()
    all_customers = customers_query(q="", status="")
    return render_template(
        "job_detail.html",
        title=current_app.config["APP_TITLE"],
        services=services,
        customers=all_customers,
        statuses=JOB_STATUS_LABELS,
        **data,
    )


@bp.get("/gestionale/lavori/<int:job_id>/modifica")
@require_admin
def job_edit_page(job_id: int):
    job = db.session.get(Job, job_id)
    if not job:
        return "Lavoro non trovato", 404
    services = get_all_services()
    all_customers = customers_query(q="", status="")
    return render_template(
        "job_form.html",
        title=current_app.config["APP_TITLE"],
        job=job,
        services=services,
        customers=all_customers,
        statuses=JOB_STATUS_LABELS,
        preselect_customer="",
    )


@bp.post("/gestionale/lavori/<int:job_id>/modifica")
@require_admin
def job_edit_submit(job_id: int):
    updated = update_job(job_id, request.form)
    if not updated:
        return "Lavoro non trovato", 404
    return redirect(f"/gestionale/lavori/{job_id}")


@bp.post("/gestionale/lavori/<int:job_id>/elimina")
@require_admin
def job_delete(job_id: int):
    job = db.session.get(Job, job_id)
    customer_id = job.customer_id if job else None
    ok = delete_job(job_id)
    if not ok:
        return "Lavoro non trovato", 404
    if customer_id:
        return redirect(f"/gestionale/clienti/{customer_id}")
    return redirect("/gestionale/lavori")


@bp.post("/gestionale/lavori/<int:job_id>/note")
@require_admin
def job_note_add(job_id: int):
    text = (request.form.get("text") or "").strip()
    if text:
        add_job_note(job_id, text)
    return redirect(f"/gestionale/lavori/{job_id}#tab-note")


@bp.post("/gestionale/lavori/<int:job_id>/note/<int:note_id>/modifica")
@require_admin
def job_note_edit(job_id: int, note_id: int):
    text = (request.form.get("text") or "").strip()
    if text:
        update_job_note(note_id, text)
    return redirect(f"/gestionale/lavori/{job_id}#tab-note")


@bp.post("/gestionale/lavori/<int:job_id>/pagamento")
@require_admin
def job_toggle_payment(job_id: int):
    toggle_job_payment(job_id)
    ref = request.referrer or ""
    if ref:
        return redirect(ref)
    return redirect(f"/gestionale/lavori/{job_id}")


# ---------------------------------------------------------------------------
# Servizi
# ---------------------------------------------------------------------------

@bp.get("/gestionale/servizi")
@require_admin
def services_page():
    rows = services_query()
    return render_template(
        "services.html",
        title=current_app.config["APP_TITLE"],
        rows=rows,
    )


@bp.post("/gestionale/servizi/nuovo")
@require_admin
def service_new_submit():
    name = (request.form.get("name") or "").strip()
    if not name:
        return redirect("/gestionale/servizi")
    create_service(request.form)
    return redirect("/gestionale/servizi")


@bp.post("/gestionale/servizi/crea-inline")
@require_admin
def service_create_inline():
    """JSON endpoint: create a service and return it for the job form picker."""
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return {"error": "Il nome è obbligatorio."}, 400
    from sqlalchemy.exc import IntegrityError as _IE
    try:
        svc = create_service(data)
    except _IE:
        db.session.rollback()
        return {"error": "Servizio già esistente con questo nome."}, 400
    return {
        "id": svc.id,
        "name": svc.name,
        "price": float(svc.price),
        "billing_type": svc.billing_type,
        "billing_interval": svc.billing_interval,
    }


@bp.post("/gestionale/servizi/<int:service_id>/prezzo")
@require_admin
def service_price_update(service_id: int):
    new_price = request.form.get("price") or 0
    note = (request.form.get("note") or "").strip()
    update_service_price(service_id, new_price, note)
    return redirect("/gestionale/servizi")


# ---------------------------------------------------------------------------
# Area personale — ticket
# ---------------------------------------------------------------------------

@bp.post("/areapersonale/ticket/nuovo")
@require_customer
def areapersonale_ticket_new():
    from flask import g
    wp_user_id = int(g.user.get("sub") or 0)
    user_email = str(g.user.get("email") or "").lower()

    subject = (request.form.get("subject") or "").strip()
    message = (request.form.get("message") or "").strip()
    if not subject or not message:
        return redirect("/areapersonale")

    from ..models import Customer as _Customer
    customer = None
    if wp_user_id:
        customer = _Customer.query.filter_by(wp_user_id=wp_user_id).first()
    if not customer and user_email:
        customer = _Customer.query.filter(_Customer.email == user_email).first()

    customer_id = customer.id if customer else None
    create_ticket(customer_id, subject, message)
    return redirect("/areapersonale")


