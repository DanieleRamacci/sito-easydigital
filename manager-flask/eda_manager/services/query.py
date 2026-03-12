from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import func, or_

from ..extensions import db
from ..models import Customer, DebtItem, Job, JobService, PaymentEntry, Service, Ticket

JOB_STATUS_LABELS = {
    "qualificazione_preventivo": "Qualificazione e preventivo",
    "scrittura_preventivo": "Scrittura preventivo",
    "in_lavorazione": "In lavorazione",
    "in_attesa_pagamento": "In attesa pagamento",
    "gestione_annuale": "Gestione annuale",
    "chiusa_acquisita": "Chiusa acquisita",
    "chiusa_persa": "Chiusa persa",
}


def parse_date(value: Any):
    if not value:
        return None
    text = str(value)[:10]
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return None


def parse_money(value: Any) -> float:
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


def debt_outstanding(total: Any, paid: Any) -> float:
    return max(0.0, parse_money(total) - parse_money(paid))


def upsert_debt_from_job(job: Job) -> None:
    if not job:
        return
    debt = DebtItem.query.filter_by(source_type="job", source_id=job.id).first()
    if debt is None:
        debt = DebtItem(source_type="job", source_id=job.id)
        db.session.add(debt)

    debt.customer_id = job.customer_id
    debt.item_type = "one_time"
    debt.label = job.title or "Lavoro"
    debt.due_date = job.due_date
    debt.amount_total = parse_money(job.amount)
    debt.amount_paid = parse_money(debt.amount_paid)
    debt.status = "open"


def sync_all_debts_from_jobs() -> None:
    for job in Job.query.all():
        upsert_debt_from_job(job)
    db.session.commit()


def dashboard_data() -> dict[str, Any]:
    customers_count = Customer.query.count()
    jobs_count = Job.query.count()
    tickets_open = Ticket.query.filter(Ticket.status != "closed").count()

    debt_rows = debt_rows_query(limit=12)
    debt_out = sum(r["outstanding"] for r in debt_rows)

    jobs = jobs_query(q="", status="", limit=12)
    customers = customers_query(q="", status="", limit=12)
    tickets = tickets_query(q="", status="", limit=12)

    return {
        "kpi": {
            "customers": customers_count,
            "jobs": jobs_count,
            "tickets_open": tickets_open,
            "debt_outstanding": debt_out,
        },
        "jobs": jobs,
        "debts": debt_rows,
        "customers": customers,
        "tickets": tickets,
    }


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
                "title": job.title,
                "status": enum_value(job.status),
                "status_label": JOB_STATUS_LABELS.get(enum_value(job.status), enum_value(job.status)),
                "customer_name": customer_name,
                "services_label": services_label,
                "dueDate": job.due_date,
                "amount": parse_money(job.amount),
            }
        )
    return jobs


def debt_rows_query(q: str = "", payment: str = "", limit: Optional[int] = None) -> list[dict[str, Any]]:
    query = db.session.query(DebtItem, Customer).outerjoin(Customer, Customer.id == DebtItem.customer_id)

    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(DebtItem.label.ilike(like), Customer.company.ilike(like)))

    rows: list[dict[str, Any]] = []
    for debt, customer in query.order_by(DebtItem.due_date.asc(), DebtItem.id.asc()).all():
        outstanding = debt_outstanding(debt.amount_total, debt.amount_paid)
        payment_status = "paid" if outstanding <= 0.009 else "pending"
        if payment and payment_status != payment:
            continue
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
                "amount_total": parse_money(debt.amount_total),
                "amount_paid": parse_money(debt.amount_paid),
                "outstanding": outstanding,
                "payment_status": payment_status,
            }
        )

    if limit:
        rows = rows[:limit]
    return rows


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


def add_payment(debt_id: int, amount: float, payment_date: Optional[date], note: str = "") -> None:
    debt = db.session.get(DebtItem, debt_id)
    if not debt:
        return
    entry = PaymentEntry(
        debt_item_id=debt.id,
        customer_id=debt.customer_id,
        amount=amount,
        date=payment_date or date.today(),
        note=note,
    )
    db.session.add(entry)
    debt.amount_paid = parse_money(debt.amount_paid) + amount
    db.session.commit()


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
