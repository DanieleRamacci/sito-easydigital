import json
from datetime import datetime
from pathlib import Path
from typing import Any

from .extensions import db
from .models import (
    AuditLog,
    CustomerContact,
    Customer,
    DebtItem,
    Invite,
    Job,
    JobService,
    PaymentEntry,
    Service,
    ServicePriceHistory,
    Subscription,
    Ticket,
)


def parse_date(value: Any):
    if not value:
        return None
    text = str(value)[:10]
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return None


def parse_dt(value: Any):
    if not value:
        return None
    text = str(value).replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def parse_money(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def clear_all():
    for model in [
        JobService,
        PaymentEntry,
        DebtItem,
        Ticket,
        Subscription,
        Invite,
        ServicePriceHistory,
        AuditLog,
        CustomerContact,
        Job,
        Service,
        Customer,
    ]:
        db.session.query(model).delete()
    db.session.commit()


def import_from_store_json(store_path: Path) -> dict[str, int]:
    raw = json.loads(store_path.read_text(encoding="utf-8"))

    clear_all()
    known_customer_ids = set()

    for s in raw.get("services", []):
        db.session.add(
            Service(
                id=int(s.get("id") or 0),
                name=s.get("name") or "",
                description=s.get("description") or "",
                price=parse_money(s.get("price")),
                billing_type=s.get("billingType") or "one_time",
                billing_interval=s.get("billingInterval") or "annual",
                active=bool(s.get("active", True)),
                created_at=parse_dt(s.get("createdAt")) or datetime.utcnow(),
                updated_at=parse_dt(s.get("updatedAt")) or datetime.utcnow(),
            )
        )

    for c in raw.get("customers", []):
        cid = int(c.get("id") or 0)
        if cid <= 0:
            continue
        db.session.add(
            Customer(
                id=cid,
                company=c.get("company") or "",
                # keep data load robust even if legacy row has no email
                email=(c.get("email") or f"missing-email-{cid}@invalid.local"),
                website=c.get("website") or "",
                vat=c.get("vat") or "",
                first_name=c.get("firstName") or "",
                last_name=c.get("lastName") or "",
                phone=c.get("phone") or "",
                billing_address=c.get("billingAddress") or "",
                pec=c.get("pec") or "",
                sdi=c.get("sdi") or "",
                status=c.get("status") or "lead",
                wp_user_id=c.get("wpUserId"),
                created_at=parse_dt(c.get("createdAt")) or datetime.utcnow(),
                updated_at=parse_dt(c.get("updatedAt")) or datetime.utcnow(),
            )
        )
        known_customer_ids.add(cid)

    db.session.flush()

    placeholder_counter = 1

    def ensure_customer_id(raw_customer_id: Any) -> int:
        nonlocal placeholder_counter
        try:
            cid = int(raw_customer_id or 0)
        except (TypeError, ValueError):
            cid = 0
        if cid > 0 and cid in known_customer_ids:
            return cid
        if cid > 0 and cid not in known_customer_ids:
            db.session.add(
                Customer(
                    id=cid,
                    company=f"Cliente {cid}",
                    email=f"missing-email-{cid}@invalid.local",
                    status="lead",
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                )
            )
            known_customer_ids.add(cid)
            return cid

        while True:
            synthetic_id = 9_000_000 + placeholder_counter
            placeholder_counter += 1
            if synthetic_id not in known_customer_ids:
                db.session.add(
                    Customer(
                        id=synthetic_id,
                        company=f"Cliente placeholder {synthetic_id}",
                        email=f"placeholder-{synthetic_id}@invalid.local",
                        status="lead",
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow(),
                    )
                )
                known_customer_ids.add(synthetic_id)
                return synthetic_id

    for j in raw.get("jobs", []):
        db.session.add(
            Job(
                id=int(j.get("id") or 0),
                customer_id=ensure_customer_id(j.get("customerId")),
                title=j.get("title") or "Lavoro",
                notes=j.get("notes") or "",
                description=j.get("description") or "",
                due_date=parse_date(j.get("dueDate")),
                start_date=parse_date(j.get("startDate")),
                amount=parse_money(j.get("amount")),
                status=j.get("status") or "qualificazione_preventivo",
                created_at=parse_dt(j.get("createdAt")) or datetime.utcnow(),
                updated_at=parse_dt(j.get("updatedAt")) or datetime.utcnow(),
            )
        )

    db.session.flush()

    for j in raw.get("jobs", []):
        job_id = int(j.get("id") or 0)
        service_ids = j.get("serviceIds") if isinstance(j.get("serviceIds"), list) else []
        if not service_ids and j.get("serviceId"):
            service_ids = [j.get("serviceId")]
        for sid in service_ids:
            if not sid:
                continue
            db.session.add(JobService(job_id=job_id, service_id=int(sid)))

    for contact in raw.get("customerContacts", []):
        cid = ensure_customer_id(contact.get("customerId"))
        db.session.add(
            CustomerContact(
                id=int(contact.get("id") or 0),
                customer_id=cid,
                name=contact.get("name") or "Contatto",
                email=contact.get("email"),
                created_at=parse_dt(contact.get("createdAt")) or datetime.utcnow(),
                updated_at=parse_dt(contact.get("updatedAt")) or datetime.utcnow(),
            )
        )

    for sub in raw.get("subscriptions", []):
        db.session.add(
            Subscription(
                id=int(sub.get("id") or 0),
                customer_id=ensure_customer_id(sub.get("customerId")),
                job_id=sub.get("jobId"),
                service_id=sub.get("serviceId") or 0,
                purchase_date=parse_date(sub.get("purchaseDate")) or datetime.utcnow().date(),
                renewal_date=parse_date(sub.get("renewalDate")),
                billing_type=sub.get("billingType") or "one_time",
                billing_interval=sub.get("billingInterval") or "annual",
                price_at_sale=parse_money(sub.get("priceAtSale")),
                status=sub.get("status") or "active",
                payment_status=sub.get("paymentStatus") or "pending",
                notes=sub.get("notes") or "",
                last_paid_at=parse_date(sub.get("lastPaidAt") or sub.get("lastReminderSent")),
                created_at=parse_dt(sub.get("createdAt")) or datetime.utcnow(),
                updated_at=parse_dt(sub.get("updatedAt")) or datetime.utcnow(),
            )
        )

    for t in raw.get("tickets", []):
        db.session.add(
            Ticket(
                id=int(t.get("id") or 0),
                customer_id=t.get("customerId"),
                subject=t.get("subject") or "Ticket",
                message=t.get("message") or "-",
                status=t.get("status") or "open",
                created_at=parse_dt(t.get("createdAt")) or datetime.utcnow(),
                updated_at=parse_dt(t.get("updatedAt")) or datetime.utcnow(),
            )
        )

    for d in raw.get("debtItems", []):
        db.session.add(
            DebtItem(
                id=int(d.get("id") or 0),
                customer_id=ensure_customer_id(d.get("customerId")),
                source_type=d.get("sourceType") or "job",
                source_id=int(d.get("sourceId") or 0),
                item_type=d.get("itemType") or "one_time",
                label=d.get("label") or "Voce",
                due_date=parse_date(d.get("dueDate")),
                amount_total=parse_money(d.get("amountTotal")),
                amount_paid=parse_money(d.get("amountPaid")),
                status=d.get("status") or "open",
                created_at=parse_dt(d.get("createdAt")) or datetime.utcnow(),
                updated_at=parse_dt(d.get("updatedAt")) or datetime.utcnow(),
            )
        )

    for p in raw.get("paymentEntries", []):
        db.session.add(
            PaymentEntry(
                id=int(p.get("id") or 0),
                debt_item_id=int(p.get("debtItemId") or 0),
                customer_id=p.get("customerId"),
                date=parse_date(p.get("date")) or datetime.utcnow().date(),
                amount=parse_money(p.get("amount")),
                note=p.get("note") or "",
                created_at=parse_dt(p.get("createdAt")) or datetime.utcnow(),
            )
        )

    for i in raw.get("invites", []):
        db.session.add(
            Invite(
                id=int(i.get("id") or 0),
                customer_id=ensure_customer_id(i.get("customerId")),
                token=i.get("token") or "",
                status=i.get("status") or "pending",
                expires_at=parse_dt(i.get("expiresAt")) or datetime.utcnow(),
                completed_at=parse_dt(i.get("completedAt")),
                created_at=parse_dt(i.get("createdAt")) or datetime.utcnow(),
            )
        )

    db.session.commit()
    return {
        "services": len(raw.get("services", [])),
        "customers": len(raw.get("customers", [])),
        "jobs": len(raw.get("jobs", [])),
        "subscriptions": len(raw.get("subscriptions", [])),
        "tickets": len(raw.get("tickets", [])),
        "debt_items": len(raw.get("debtItems", [])),
        "payment_entries": len(raw.get("paymentEntries", [])),
        "invites": len(raw.get("invites", [])),
        "customer_contacts": len(raw.get("customerContacts", [])),
    }
