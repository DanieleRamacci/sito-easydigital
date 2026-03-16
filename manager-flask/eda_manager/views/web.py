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
    except Exception:
        db.session.rollback()
        return render_template(
            "customer_form.html",
            title=current_app.config["APP_TITLE"],
            customer=None,
            error="Email già presente nel sistema.",
        )
    return redirect(f"/gestionale/clienti/{customer.id}")


@bp.post("/gestionale/clienti/<int:customer_id>/modifica")
@require_admin
def customer_edit_submit(customer_id: int):
    updated = update_customer(customer_id, request.form)
    if not updated:
        return "Cliente non trovato", 404
    return redirect(f"/gestionale/clienti/{customer_id}")


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


