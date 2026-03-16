from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Optional

from dateutil.relativedelta import relativedelta
from sqlalchemy import func, or_, text

from ..extensions import db
from ..models import (
    BillingInterval,
    BillingType,
    Customer,
    CustomerNote,
    DebtItem,
    Invite,
    Job,
    JobNote,
    JobService,
    JobStatus,
    Notification,
    PaymentEntry,
    PaymentStatus,
    Service,
    ServicePriceHistory,
    Subscription,
    Ticket,
)

JOB_STATUS_LABELS = {
    "qualificazione_preventivo": "Qualificazione e preventivo",
    "scrittura_preventivo": "Scrittura preventivo",
    "in_lavorazione": "In lavorazione",
    "in_attesa_pagamento": "In attesa pagamento",
    "gestione_annuale": "Gestione annuale",
    "chiusa_acquisita": "Chiusa acquisita",
    "chiusa_persa": "Chiusa persa",
}

BILLING_INTERVAL_LABELS = {
    "monthly": "Mensile",
    "semiannual": "Semestrale",
    "annual": "Annuale",
}

INTERVAL_DELTA = {
    BillingInterval.MONTHLY.value: relativedelta(months=1),
    BillingInterval.SEMIANNUAL.value: relativedelta(months=6),
    BillingInterval.ANNUAL.value: relativedelta(years=1),
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def parse_date(value: Any) -> Optional[date]:
    if not value:
        return None
    text = str(value)[:10]
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return None


def parse_decimal(value: Any) -> Decimal:
    """Precise Decimal parsing for monetary operations."""
    try:
        if isinstance(value, Decimal):
            return value
        return Decimal(str(value or 0))
    except (InvalidOperation, TypeError):
        return Decimal("0")


def parse_money(value: Any) -> float:
    """Float for display/template rendering only. Use parse_decimal for calculations."""
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def enum_value(value: Any) -> str:
    if hasattr(value, "value"):
        return str(value.value)
    return str(value or "")


def format_date_it(value: Any) -> str:
    if not value:
        return "-"
    if isinstance(value, date):
        return value.strftime("%d/%m/%Y")
    d = parse_date(value)
    return d.strftime("%d/%m/%Y") if d else str(value)[:10]


def debt_outstanding(total: Any, paid: Any) -> Decimal:
    """Returns Decimal residuo. Zero if over-paid."""
    result = parse_decimal(total) - parse_decimal(paid)
    return result if result > Decimal("0") else Decimal("0")


def advance_renewal(renewal_date: date, interval: str) -> date:
    """Calculate the next renewal date based on billing interval."""
    delta = INTERVAL_DELTA.get(interval, relativedelta(years=1))
    return renewal_date + delta


# ---------------------------------------------------------------------------
# Debt helpers
# ---------------------------------------------------------------------------

def upsert_debt_from_job(job: Job) -> None:
    """Create or update the DebtItem linked to a Job.
    Never reduces amount_paid or resets status to open if already paid.
    """
    if not job:
        return
    debt = DebtItem.query.filter_by(source_type="job", source_id=job.id).first()
    if debt is None:
        debt = DebtItem(source_type="job", source_id=job.id, amount_paid=Decimal("0"))
        db.session.add(debt)

    debt.customer_id = job.customer_id
    debt.item_type = "one_time"
    debt.label = job.title or "Lavoro"
    debt.due_date = job.due_date
    debt.amount_total = parse_decimal(job.amount)
    # Only recalculate status — never touch amount_paid
    outstanding = debt_outstanding(debt.amount_total, debt.amount_paid)
    debt.status = "paid" if outstanding <= Decimal("0.01") else "open"


def upsert_debt_from_subscription(sub: "Subscription") -> Optional[DebtItem]:
    """Create a new DebtItem for a subscription renewal cycle, if one doesn't already exist open."""
    if sub.billing_type != BillingType.SUBSCRIPTION.value:
        return None
    # Don't create if there's already an open debt for this subscription
    existing = DebtItem.query.filter_by(
        source_type="subscription", source_id=sub.id, status="open"
    ).first()
    if existing:
        return existing

    service_name = sub.service.name if sub.service else f"Servizio #{sub.service_id}"
    label = f"Rinnovo {service_name} — {format_date_it(sub.renewal_date)}"

    debt = DebtItem(
        customer_id=sub.customer_id,
        source_type="subscription",
        source_id=sub.id,
        item_type="subscription",
        label=label,
        due_date=sub.renewal_date,
        amount_total=parse_decimal(sub.price_at_sale),
        amount_paid=Decimal("0"),
        status="open",
    )
    db.session.add(debt)
    return debt


def sync_all_debts_from_jobs() -> None:
    for job in Job.query.all():
        upsert_debt_from_job(job)
    db.session.commit()


# ---------------------------------------------------------------------------
# Renewals
# ---------------------------------------------------------------------------

def process_renewals() -> list[str]:
    """Generate DebtItems and Notifications for subscriptions whose renewal_date has arrived."""
    today = date.today()
    subs = Subscription.query.filter(
        Subscription.billing_type == BillingType.SUBSCRIPTION.value,
        Subscription.status == "active",
        Subscription.renewal_date <= today,
    ).all()

    created = []
    for sub in subs:
        existing_open = DebtItem.query.filter_by(
            source_type="subscription", source_id=sub.id, status="open"
        ).first()
        if not existing_open:
            debt = upsert_debt_from_subscription(sub)
            if debt:
                service_name = sub.service.name if sub.service else f"Servizio #{sub.service_id}"
                customer_name = sub.customer.company if sub.customer else f"Cliente #{sub.customer_id}"
                notif = Notification(
                    title=f"Rinnovo: {service_name}",
                    message=f"{customer_name} — scadenza {format_date_it(sub.renewal_date)}",
                    notif_type="warning",
                    customer_id=sub.customer_id,
                    subscription_id=sub.id,
                )
                db.session.add(notif)
                created.append(f"Sub #{sub.id} ({service_name})")

    db.session.commit()
    return created


def renewals_query(months_ahead: int = 2) -> list[dict[str, Any]]:
    """Return upcoming subscription renewals ordered by renewal_date."""
    today = date.today()
    cutoff = today + relativedelta(months=months_ahead)

    subs = (
        Subscription.query
        .filter(
            Subscription.billing_type == BillingType.SUBSCRIPTION.value,
            Subscription.status == "active",
            Subscription.renewal_date >= today,
            Subscription.renewal_date <= cutoff,
        )
        .order_by(Subscription.renewal_date.asc())
        .all()
    )

    rows = []
    for sub in subs:
        customer = db.session.get(Customer, sub.customer_id)
        service = db.session.get(Service, sub.service_id)
        customer_name = (customer.company if customer else "") or "-"
        service_name = (service.name if service else "") or "-"

        open_debt = DebtItem.query.filter_by(
            source_type="subscription", source_id=sub.id, status="open"
        ).first()
        outstanding = debt_outstanding(open_debt.amount_total, open_debt.amount_paid) if open_debt else Decimal("0")
        payment_status = "paid" if (open_debt is None or outstanding <= Decimal("0.01")) else "pending"

        rows.append({
            "sub_id": sub.id,
            "customer_id": sub.customer_id,
            "customer_name": customer_name,
            "service_name": service_name,
            "renewal_date": sub.renewal_date,
            "billing_interval": sub.billing_interval,
            "interval_label": BILLING_INTERVAL_LABELS.get(enum_value(sub.billing_interval), "-"),
            "price": parse_decimal(sub.price_at_sale),
            "payment_status": payment_status,
            "debt_id": open_debt.id if open_debt else None,
        })
    return rows


def dashboard_renewals_widget() -> list[dict[str, Any]]:
    """Renewals due this month + overdue."""
    today = date.today()
    end_of_month = today.replace(day=1) + relativedelta(months=1) - relativedelta(days=1)

    subs = (
        Subscription.query
        .filter(
            Subscription.billing_type == BillingType.SUBSCRIPTION.value,
            Subscription.status == "active",
            Subscription.renewal_date <= end_of_month,
        )
        .order_by(Subscription.renewal_date.asc())
        .all()
    )

    rows = []
    for sub in subs:
        customer = db.session.get(Customer, sub.customer_id)
        service = db.session.get(Service, sub.service_id)
        open_debt = DebtItem.query.filter_by(
            source_type="subscription", source_id=sub.id, status="open"
        ).first()
        outstanding = debt_outstanding(open_debt.amount_total, open_debt.amount_paid) if open_debt else Decimal("0")
        payment_status = "paid" if (open_debt is None or outstanding <= Decimal("0.01")) else "pending"

        rows.append({
            "sub_id": sub.id,
            "customer_id": sub.customer_id,
            "customer_name": (customer.company if customer else "") or "-",
            "service_name": (service.name if service else "") or "-",
            "renewal_date": sub.renewal_date,
            "price": parse_decimal(sub.price_at_sale),
            "payment_status": payment_status,
            "debt_id": open_debt.id if open_debt else None,
            "overdue": sub.renewal_date < today,
        })
    return rows


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

def dashboard_data() -> dict[str, Any]:
    customers_count = Customer.query.count()
    jobs_count = Job.query.count()
    tickets_open = Ticket.query.filter(Ticket.status != "closed").count()

    # Total outstanding: sum of (amount_total - amount_paid) for open debts
    from sqlalchemy import cast, Numeric as SANumeric
    result = db.session.execute(
        text("SELECT COALESCE(SUM(amount_total - amount_paid), 0) FROM debt_items WHERE status = 'open'")
    ).scalar()
    debt_out = float(result or 0)

    notifications = (
        Notification.query
        .filter_by(read=False)
        .order_by(Notification.created_at.desc())
        .limit(20)
        .all()
    )
    renewals_widget = dashboard_renewals_widget()

    jobs = jobs_query(q="", status="", limit=10)
    debts = debt_rows_query(limit=10)
    customers = customers_query(q="", status="", limit=8)
    tickets = tickets_query(q="", status="", limit=8)

    return {
        "kpi": {
            "customers": customers_count,
            "jobs": jobs_count,
            "tickets_open": tickets_open,
            "debt_outstanding": debt_out,
            "renewals_this_month": len([r for r in renewals_widget if r["payment_status"] == "pending"]),
        },
        "jobs": jobs,
        "debts": debts,
        "customers": customers,
        "tickets": tickets,
        "notifications": notifications,
        "renewals_widget": renewals_widget,
    }


# ---------------------------------------------------------------------------
# Customers
# ---------------------------------------------------------------------------

def customers_query(q: str, status: str, limit: Optional[int] = None) -> list[Customer]:
    query = Customer.query
    if status:
        query = query.filter(Customer.status == status)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            or_(
                Customer.company.ilike(like),
                Customer.first_name.ilike(like),
                Customer.last_name.ilike(like),
                Customer.email.ilike(like),
                Customer.phone.ilike(like),
            )
        )
    query = query.order_by(func.lower(Customer.company))
    if limit:
        query = query.limit(limit)
    return query.all()


def customer_detail_data(customer_id: int) -> Optional[dict[str, Any]]:
    customer = db.session.get(Customer, customer_id)
    if not customer:
        return None

    all_jobs = Job.query.filter_by(customer_id=customer_id).order_by(Job.created_at.desc()).all()
    active_jobs = [j for j in all_jobs if j.status not in (
        JobStatus.CHIUSA_ACQUISITA.value, JobStatus.CHIUSA_PERSA.value
    )]
    closed_won_jobs = [j for j in all_jobs if j.status == JobStatus.CHIUSA_ACQUISITA.value]
    closed_lost_jobs = [j for j in all_jobs if j.status == JobStatus.CHIUSA_PERSA.value]

    subscriptions = (
        Subscription.query
        .filter_by(customer_id=customer_id)
        .order_by(Subscription.renewal_date.asc())
        .all()
    )

    open_debts_raw = (
        DebtItem.query
        .filter_by(customer_id=customer_id, status="open")
        .order_by(DebtItem.due_date.asc())
        .all()
    )
    open_debts = []
    total_outstanding = Decimal("0")
    for d in open_debts_raw:
        outstanding = debt_outstanding(d.amount_total, d.amount_paid)
        total_outstanding += outstanding
        open_debts.append({
            "debt_id": d.id,
            "label": d.label,
            "source_type": d.source_type,
            "due_date": d.due_date,
            "amount_total": parse_decimal(d.amount_total),
            "amount_paid": parse_decimal(d.amount_paid),
            "outstanding": outstanding,
        })

    # Paid debts (historical)
    paid_debts_raw = (
        DebtItem.query
        .filter_by(customer_id=customer_id, status="paid")
        .order_by(DebtItem.due_date.desc())
        .all()
    )

    # Payment history (all PaymentEntry for this customer)
    payment_history = (
        db.session.query(PaymentEntry, DebtItem)
        .join(DebtItem, DebtItem.id == PaymentEntry.debt_item_id)
        .filter(PaymentEntry.customer_id == customer_id)
        .order_by(PaymentEntry.date.desc())
        .all()
    )
    payment_rows = [
        {
            "id": pe.id,
            "date": pe.date,
            "amount": parse_decimal(pe.amount),
            "note": pe.note,
            "debt_label": di.label,
        }
        for pe, di in payment_history
    ]

    note_list = customer.notes.order_by(CustomerNote.created_at.desc()).all()

    return {
        "customer": customer,
        "active_jobs": active_jobs,
        "closed_won_jobs": closed_won_jobs,
        "closed_lost_jobs": closed_lost_jobs,
        "subscriptions": subscriptions,
        "open_debts": open_debts,
        "paid_debts": paid_debts_raw,
        "total_outstanding": total_outstanding,
        "payment_history": payment_rows,
        "note_list": note_list,
    }


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------

def jobs_query(q: str, status: str, limit: Optional[int] = None) -> list[dict[str, Any]]:
    query = db.session.query(Job, Customer).outerjoin(Customer, Customer.id == Job.customer_id)
    if status:
        query = query.filter(Job.status == status)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            or_(
                Job.title.ilike(like),
                Job.notes.ilike(like),
                Job.description.ilike(like),
                Customer.company.ilike(like),
                Customer.email.ilike(like),
            )
        )

    query = query.order_by(Job.updated_at.desc(), Job.created_at.desc())
    if limit:
        query = query.limit(limit)

    jobs = []
    for job, customer in query.all():
        service_names = (
            db.session.query(Service.name)
            .join(JobService, JobService.service_id == Service.id)
            .filter(JobService.job_id == job.id)
            .order_by(Service.name.asc())
            .all()
        )
        services_label = ", ".join([s[0] for s in service_names]) if service_names else "-"
        customer_name = "-"
        if customer:
            customer_name = customer.company or f"{customer.first_name or ''} {customer.last_name or ''}".strip() or "-"

        jobs.append(
            {
                "id": job.id,
                "customer_id": job.customer_id,
                "title": job.title,
                "status": enum_value(job.status),
                "status_label": JOB_STATUS_LABELS.get(enum_value(job.status), enum_value(job.status)),
                "customer_name": customer_name,
                "services_label": services_label,
                "dueDate": job.due_date,
                "amount": parse_decimal(job.amount),
            }
        )
    return jobs


# ---------------------------------------------------------------------------
# Debts
# ---------------------------------------------------------------------------

def debt_rows_query(
    q: str = "",
    payment: str = "",
    customer_id: Optional[int] = None,
    limit: Optional[int] = None,
) -> list[dict[str, Any]]:
    query = db.session.query(DebtItem, Customer).outerjoin(Customer, Customer.id == DebtItem.customer_id)

    if customer_id:
        query = query.filter(DebtItem.customer_id == customer_id)

    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(DebtItem.label.ilike(like), Customer.company.ilike(like)))

    # Filter payment status in SQL — avoids Python-side filtering which breaks LIMIT
    if payment == "paid":
        query = query.filter(
            (DebtItem.amount_total - DebtItem.amount_paid) <= Decimal("0.01")
        )
    elif payment == "pending":
        query = query.filter(
            (DebtItem.amount_total - DebtItem.amount_paid) > Decimal("0.01")
        )

    query = query.order_by(DebtItem.due_date.asc(), DebtItem.id.asc())
    if limit:
        query = query.limit(limit)

    rows: list[dict[str, Any]] = []
    for debt, customer in query.all():
        outstanding = debt_outstanding(debt.amount_total, debt.amount_paid)
        payment_status = "paid" if outstanding <= Decimal("0.01") else "pending"
        rows.append(
            {
                "debt_id": debt.id,
                "source_type": debt.source_type,
                "source_id": debt.source_id,
                "customer_id": debt.customer_id,
                "customer_name": (customer.company if customer else "") or "-",
                "item_name": debt.label or "Voce",
                "item_type": debt.item_type,
                "due_date": debt.due_date,
                "amount_total": parse_decimal(debt.amount_total),
                "amount_paid": parse_decimal(debt.amount_paid),
                "outstanding": outstanding,
                "payment_status": payment_status,
            }
        )
    return rows


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------

def add_payment(
    debt_id: int, amount: float, payment_date: Optional[date], note: str = ""
) -> dict[str, Any]:
    debt = db.session.get(DebtItem, debt_id)
    if not debt:
        return {"error": "Debito non trovato"}

    outstanding = debt_outstanding(debt.amount_total, debt.amount_paid)
    if outstanding <= Decimal("0.01"):
        return {"error": "Questo debito è già saldato"}

    # Cap payment at outstanding to prevent overpayment
    amount_dec = parse_decimal(amount)
    if amount_dec <= Decimal("0"):
        return {"error": "Importo non valido"}
    amount_to_pay = min(amount_dec, outstanding)

    try:
        entry = PaymentEntry(
            debt_item_id=debt.id,
            customer_id=debt.customer_id,
            amount=amount_to_pay,
            date=payment_date or date.today(),
            note=note,
        )
        db.session.add(entry)
        debt.amount_paid = parse_decimal(debt.amount_paid) + amount_to_pay

        new_outstanding = debt_outstanding(debt.amount_total, debt.amount_paid)
        if new_outstanding <= Decimal("0.01"):
            debt.status = "paid"
            # If subscription debt: advance renewal_date and reset payment cycle
            if debt.source_type == "subscription" and debt.source_id:
                sub = db.session.get(Subscription, debt.source_id)
                if sub and sub.billing_type == BillingType.SUBSCRIPTION.value:
                    sub.last_paid_at = payment_date or date.today()
                    sub.payment_status = PaymentStatus.PENDING.value
                    if sub.renewal_date:
                        sub.renewal_date = advance_renewal(
                            sub.renewal_date, enum_value(sub.billing_interval)
                        )

        db.session.commit()
        was_capped = amount_to_pay < amount_dec
        return {"success": True, "amount": float(amount_to_pay), "capped": was_capped}
    except Exception:
        db.session.rollback()
        raise


# ---------------------------------------------------------------------------
# Subscriptions
# ---------------------------------------------------------------------------

def subscriptions_query(
    customer_id: Optional[int] = None,
    status: str = "",
    limit: Optional[int] = None,
) -> list[dict[str, Any]]:
    query = (
        db.session.query(Subscription, Customer, Service)
        .outerjoin(Customer, Customer.id == Subscription.customer_id)
        .outerjoin(Service, Service.id == Subscription.service_id)
    )
    if customer_id:
        query = query.filter(Subscription.customer_id == customer_id)
    if status:
        query = query.filter(Subscription.status == status)
    query = query.order_by(Subscription.renewal_date.asc())
    if limit:
        query = query.limit(limit)

    rows = []
    for sub, customer, service in query.all():
        open_debt = DebtItem.query.filter_by(
            source_type="subscription", source_id=sub.id, status="open"
        ).first()
        outstanding = debt_outstanding(open_debt.amount_total, open_debt.amount_paid) if open_debt else Decimal("0")
        payment_status = "paid" if (open_debt is None or outstanding <= Decimal("0.01")) else "pending"

        rows.append({
            "sub_id": sub.id,
            "customer_id": sub.customer_id,
            "customer_name": (customer.company if customer else "") or "-",
            "service_id": sub.service_id,
            "service_name": (service.name if service else "") or "-",
            "billing_type": enum_value(sub.billing_type),
            "billing_interval": enum_value(sub.billing_interval),
            "interval_label": BILLING_INTERVAL_LABELS.get(enum_value(sub.billing_interval), "-"),
            "purchase_date": sub.purchase_date,
            "renewal_date": sub.renewal_date,
            "price": parse_decimal(sub.price_at_sale),
            "status": sub.status,
            "payment_status": payment_status,
            "debt_id": open_debt.id if open_debt else None,
            "notes": sub.notes or "",
        })
    return rows


def get_all_services() -> list[Service]:
    return Service.query.filter_by(active=True).order_by(Service.name.asc()).all()


# ---------------------------------------------------------------------------
# Invites
# ---------------------------------------------------------------------------

def create_invite(customer_id: int) -> Optional[Invite]:
    import secrets
    from datetime import datetime, timedelta

    customer = db.session.get(Customer, customer_id)
    if not customer:
        return None

    # Invalidate any existing pending invites
    Invite.query.filter_by(customer_id=customer_id, status="pending").update({"status": "cancelled"})

    token = secrets.token_urlsafe(32)
    invite = Invite(
        customer_id=customer_id,
        token=token,
        status="pending",
        expires_at=datetime.utcnow() + timedelta(days=7),
    )
    db.session.add(invite)
    customer.status = "invited"
    db.session.commit()
    return invite


def get_invite_by_token(token: str) -> Optional[Invite]:
    from datetime import datetime

    invite = Invite.query.filter_by(token=token).first()
    if not invite:
        return None
    if invite.status != "pending":
        return None
    if invite.expires_at < datetime.utcnow():
        invite.status = "expired"
        db.session.commit()
        return None
    return invite


# ---------------------------------------------------------------------------
# Tickets
# ---------------------------------------------------------------------------

def tickets_query(q: str, status: str, limit: Optional[int] = None) -> list[dict[str, Any]]:
    query = db.session.query(Ticket, Customer).outerjoin(Customer, Customer.id == Ticket.customer_id)
    if status:
        query = query.filter(Ticket.status == status)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            or_(
                Ticket.subject.ilike(like),
                Ticket.message.ilike(like),
                Customer.company.ilike(like),
            )
        )
    query = query.order_by(Ticket.created_at.desc())
    if limit:
        query = query.limit(limit)

    rows = []
    for ticket, customer in query.all():
        rows.append(
            {
                "id": ticket.id,
                "customer_label": (customer.company if customer else "") or "-",
                "subject": ticket.subject,
                "status": enum_value(ticket.status),
                "createdAt": ticket.created_at,
            }
        )
    return rows


def update_job_status(job_id: int, status: str) -> None:
    job = db.session.get(Job, job_id)
    if not job:
        return
    job.status = status
    db.session.commit()


def update_ticket_status(ticket_id: int, status: str) -> None:
    ticket = db.session.get(Ticket, ticket_id)
    if not ticket:
        return
    ticket.status = status
    db.session.commit()


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------

def unread_notifications_count() -> int:
    return Notification.query.filter_by(read=False).count()


def mark_notification_read(notif_id: int) -> None:
    n = db.session.get(Notification, notif_id)
    if n:
        n.read = True
        db.session.commit()


# ---------------------------------------------------------------------------
# WordPress API integration
# ---------------------------------------------------------------------------

def register_wp_user(wp_base_url: str, email: str, display_name: str, password: str) -> tuple[bool, dict]:
    """Call /wp-json/eda-auth/v1/register to create a WP subscriber.
    Returns (success: bool, data: dict).
    """
    import re
    import requests as _requests

    # Build a clean username from email local part
    username = re.sub(r"[^a-z0-9_]", "", email.split("@")[0].lower()) or "user"

    try:
        resp = _requests.post(
            f"{wp_base_url.rstrip('/')}/wp-json/eda-auth/v1/register",
            json={"username": username, "email": email, "display_name": display_name, "password": password},
            timeout=10,
        )
        data = resp.json()
        return resp.ok, data
    except Exception as e:
        return False, {"message": str(e)}


# ---------------------------------------------------------------------------
# Customer personal area (areapersonale)
# ---------------------------------------------------------------------------

def customer_area_data(wp_user_id: int, user_email: str) -> Optional[dict[str, Any]]:
    """Return data for the customer's personal area, matched by wp_user_id or email."""
    customer = None
    if wp_user_id:
        customer = Customer.query.filter_by(wp_user_id=wp_user_id).first()
    if not customer and user_email:
        customer = Customer.query.filter(
            Customer.email == user_email.lower().strip()
        ).first()
    if not customer:
        return None

    # Active subscriptions
    active_subs = (
        Subscription.query
        .filter_by(customer_id=customer.id, status="active")
        .order_by(Subscription.renewal_date.asc())
        .all()
    )
    subs_out = []
    for sub in active_subs:
        service = db.session.get(Service, sub.service_id)
        open_debt = DebtItem.query.filter_by(
            source_type="subscription", source_id=sub.id, status="open"
        ).first()
        outstanding = debt_outstanding(open_debt.amount_total, open_debt.amount_paid) if open_debt else Decimal("0")
        subs_out.append({
            "service_name": service.name if service else "-",
            "billing_interval": enum_value(sub.billing_interval),
            "interval_label": BILLING_INTERVAL_LABELS.get(enum_value(sub.billing_interval), "-"),
            "renewal_date": sub.renewal_date,
            "price": parse_decimal(sub.price_at_sale),
            "payment_status": "paid" if outstanding <= Decimal("0.01") else "pending",
            "outstanding": outstanding,
        })

    # Open debts
    open_debts_raw = (
        DebtItem.query
        .filter_by(customer_id=customer.id, status="open")
        .order_by(DebtItem.due_date.asc())
        .all()
    )
    open_debts = []
    total_outstanding = Decimal("0")
    for d in open_debts_raw:
        outstanding = debt_outstanding(d.amount_total, d.amount_paid)
        total_outstanding += outstanding
        open_debts.append({
            "label": d.label,
            "item_type": d.item_type,
            "due_date": d.due_date,
            "amount_total": parse_decimal(d.amount_total),
            "outstanding": outstanding,
        })

    # Upcoming renewals (next 60 days)
    today = date.today()
    cutoff = today + relativedelta(days=60)
    upcoming_renewals = [s for s in subs_out if s["renewal_date"] and today <= s["renewal_date"] <= cutoff]

    return {
        "customer": customer,
        "subscriptions": subs_out,
        "open_debts": open_debts,
        "total_outstanding": total_outstanding,
        "upcoming_renewals": upcoming_renewals,
    }


# ---------------------------------------------------------------------------
# Customer CRUD
# ---------------------------------------------------------------------------

def create_customer(form_data: dict) -> Customer:
    customer = Customer(
        company=(form_data.get("company") or "").strip(),
        first_name=(form_data.get("first_name") or "").strip(),
        last_name=(form_data.get("last_name") or "").strip(),
        email=(form_data.get("email") or "").strip().lower(),
        phone=(form_data.get("phone") or "").strip(),
        website=(form_data.get("website") or "").strip(),
        vat=(form_data.get("vat") or "").strip(),
        billing_address=(form_data.get("billing_address") or "").strip(),
        pec=(form_data.get("pec") or "").strip(),
        sdi=(form_data.get("sdi") or "").strip(),
        status=(form_data.get("status") or "lead").strip(),
    )
    db.session.add(customer)
    db.session.commit()
    return customer


def update_customer(customer_id: int, form_data: dict) -> Optional[Customer]:
    customer = db.session.get(Customer, customer_id)
    if not customer:
        return None
    customer.company = (form_data.get("company") or customer.company).strip()
    customer.first_name = (form_data.get("first_name") or "").strip()
    customer.last_name = (form_data.get("last_name") or "").strip()
    customer.email = (form_data.get("email") or customer.email).strip().lower()
    customer.phone = (form_data.get("phone") or "").strip()
    customer.website = (form_data.get("website") or "").strip()
    customer.vat = (form_data.get("vat") or "").strip()
    customer.billing_address = (form_data.get("billing_address") or "").strip()
    customer.pec = (form_data.get("pec") or "").strip()
    customer.sdi = (form_data.get("sdi") or "").strip()
    customer.status = (form_data.get("status") or customer.status).strip()
    db.session.commit()
    return customer


def delete_customer(customer_id: int) -> bool:
    customer = db.session.get(Customer, customer_id)
    if not customer:
        return False
    db.session.delete(customer)
    db.session.commit()
    return True


def add_customer_note(customer_id: int, text: str) -> Optional[CustomerNote]:
    customer = db.session.get(Customer, customer_id)
    if not customer or not text.strip():
        return None
    note = CustomerNote(customer_id=customer_id, text=text.strip())
    db.session.add(note)
    db.session.commit()
    return note


# ---------------------------------------------------------------------------
# Job CRUD
# ---------------------------------------------------------------------------

def job_detail_data(job_id: int) -> Optional[dict]:
    job = db.session.get(Job, job_id)
    if not job:
        return None

    customer = db.session.get(Customer, job.customer_id)

    notes_list = (
        JobNote.query
        .filter_by(job_id=job_id)
        .order_by(JobNote.created_at.desc())
        .all()
    )

    debt = DebtItem.query.filter_by(source_type="job", source_id=job_id).first()
    debt_data = None
    if debt:
        outstanding = debt_outstanding(debt.amount_total, debt.amount_paid)
        debt_data = {
            "id": debt.id,
            "label": debt.label,
            "due_date": debt.due_date,
            "amount_total": parse_decimal(debt.amount_total),
            "amount_paid": parse_decimal(debt.amount_paid),
            "outstanding": outstanding,
            "status": debt.status,
        }

    return {
        "job": job,
        "customer": customer,
        "notes_list": notes_list,
        "debt": debt_data,
    }


def create_job(form_data: dict) -> Job:
    customer_id = int(form_data.get("customer_id") or 0)
    service_ids_raw = form_data.getlist("service_ids") if hasattr(form_data, "getlist") else form_data.get("service_ids", [])
    if isinstance(service_ids_raw, str):
        service_ids_raw = [service_ids_raw]
    service_ids = [int(s) for s in service_ids_raw if s]

    # Compute amount from services if not manually set
    amount_raw = form_data.get("amount") or 0
    if service_ids and not float(amount_raw or 0):
        services = Service.query.filter(Service.id.in_(service_ids)).all()
        amount = sum(parse_decimal(s.price) for s in services)
    else:
        amount = parse_decimal(amount_raw)

    job = Job(
        customer_id=customer_id,
        title=(form_data.get("title") or "").strip(),
        description=(form_data.get("description") or "").strip(),
        notes=(form_data.get("notes") or "").strip(),
        start_date=parse_date(form_data.get("start_date")),
        due_date=parse_date(form_data.get("due_date")),
        amount=amount,
        status=(form_data.get("status") or JobStatus.QUALIFICAZIONE_PREVENTIVO.value),
        payment_status="pending",
    )
    db.session.add(job)
    db.session.flush()

    for sid in service_ids:
        js = JobService(job_id=job.id, service_id=sid)
        db.session.add(js)

    upsert_debt_from_job(job)
    db.session.commit()
    return job


def update_job(job_id: int, form_data: dict) -> Optional[Job]:
    job = db.session.get(Job, job_id)
    if not job:
        return None

    service_ids_raw = form_data.getlist("service_ids") if hasattr(form_data, "getlist") else form_data.get("service_ids", [])
    if isinstance(service_ids_raw, str):
        service_ids_raw = [service_ids_raw]
    service_ids = [int(s) for s in service_ids_raw if s]

    job.title = (form_data.get("title") or job.title).strip()
    job.customer_id = int(form_data.get("customer_id") or job.customer_id)
    job.description = (form_data.get("description") or "").strip()
    job.notes = (form_data.get("notes") or "").strip()
    job.start_date = parse_date(form_data.get("start_date")) or job.start_date
    job.due_date = parse_date(form_data.get("due_date")) or job.due_date
    job.status = (form_data.get("status") or job.status)

    if service_ids:
        amount_raw = form_data.get("amount") or 0
        if not float(amount_raw or 0):
            services = Service.query.filter(Service.id.in_(service_ids)).all()
            job.amount = sum(parse_decimal(s.price) for s in services)
        else:
            job.amount = parse_decimal(amount_raw)

        # Replace service associations
        JobService.query.filter_by(job_id=job_id).delete()
        for sid in service_ids:
            js = JobService(job_id=job_id, service_id=sid)
            db.session.add(js)
    else:
        amount_raw = form_data.get("amount")
        if amount_raw is not None:
            job.amount = parse_decimal(amount_raw)

    upsert_debt_from_job(job)
    db.session.commit()
    return job


def delete_job(job_id: int) -> bool:
    job = db.session.get(Job, job_id)
    if not job:
        return False
    db.session.delete(job)
    db.session.commit()
    return True


def add_job_note(job_id: int, text: str) -> Optional[JobNote]:
    job = db.session.get(Job, job_id)
    if not job or not text.strip():
        return None
    note = JobNote(job_id=job_id, text=text.strip())
    db.session.add(note)
    db.session.commit()
    return note


def update_job_note(note_id: int, text: str) -> Optional[JobNote]:
    note = db.session.get(JobNote, note_id)
    if not note or not text.strip():
        return None
    note.text = text.strip()
    db.session.commit()
    return note


def toggle_job_payment(job_id: int) -> Optional[Job]:
    job = db.session.get(Job, job_id)
    if not job:
        return None
    if job.payment_status == "paid":
        job.payment_status = "pending"
    else:
        job.payment_status = "paid"
    db.session.commit()
    return job


# ---------------------------------------------------------------------------
# Services catalog
# ---------------------------------------------------------------------------

def services_query() -> list[dict]:
    services = Service.query.order_by(Service.name.asc()).all()
    result = []
    for svc in services:
        history = (
            ServicePriceHistory.query
            .filter_by(service_id=svc.id)
            .order_by(ServicePriceHistory.changed_at.desc())
            .all()
        )
        result.append({
            "service": svc,
            "price_history": history,
        })
    return result


def create_service(form_data: dict) -> Service:
    svc = Service(
        name=(form_data.get("name") or "").strip(),
        description=(form_data.get("description") or "").strip(),
        price=parse_decimal(form_data.get("price") or 0),
        billing_type=(form_data.get("billing_type") or BillingType.ONE_TIME.value),
        billing_interval=(form_data.get("billing_interval") or BillingInterval.ANNUAL.value),
        active=True,
    )
    db.session.add(svc)
    db.session.commit()
    return svc


def update_service_price(service_id: int, new_price: Any, note: str = "") -> Optional[Service]:
    svc = db.session.get(Service, service_id)
    if not svc:
        return None
    new_price_dec = parse_decimal(new_price)
    if new_price_dec < Decimal("0"):
        return None
    old_price = parse_decimal(svc.price)
    if old_price != new_price_dec:
        history_entry = ServicePriceHistory(
            service_id=service_id,
            old_price=old_price,
            new_price=new_price_dec,
            note=note.strip() if note else None,
        )
        db.session.add(history_entry)
    svc.price = new_price_dec
    db.session.commit()
    return svc


# ---------------------------------------------------------------------------
# Ticket creation (customer area)
# ---------------------------------------------------------------------------

def create_ticket(customer_id: Optional[int], subject: str, message: str) -> Ticket:
    ticket = Ticket(
        customer_id=customer_id,
        subject=subject.strip(),
        message=message.strip(),
        status="open",
    )
    db.session.add(ticket)
    db.session.commit()
    return ticket
