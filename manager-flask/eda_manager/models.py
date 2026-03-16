from datetime import datetime
from enum import Enum

from .extensions import db


class TimestampMixin:
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class JobStatus(str, Enum):
    QUALIFICAZIONE_PREVENTIVO = "qualificazione_preventivo"
    SCRITTURA_PREVENTIVO = "scrittura_preventivo"
    IN_LAVORAZIONE = "in_lavorazione"
    IN_ATTESA_PAGAMENTO = "in_attesa_pagamento"
    GESTIONE_ANNUALE = "gestione_annuale"
    CHIUSA_ACQUISITA = "chiusa_acquisita"
    CHIUSA_PERSA = "chiusa_persa"


class BillingType(str, Enum):
    ONE_TIME = "one_time"
    SUBSCRIPTION = "subscription"


class BillingInterval(str, Enum):
    MONTHLY = "monthly"
    SEMIANNUAL = "semiannual"
    ANNUAL = "annual"


class PaymentStatus(str, Enum):
    PENDING = "pending"
    PAID = "paid"


class TicketStatus(str, Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    CLOSED = "closed"


class Service(TimestampMixin, db.Model):
    __tablename__ = "services"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.Text, nullable=False)
    description = db.Column(db.Text, default="")
    price = db.Column(db.Numeric(12, 2), default=0, nullable=False)
    billing_type = db.Column(
        db.Enum(BillingType, values_callable=lambda x: [e.value for e in x], native_enum=False),
        default=BillingType.ONE_TIME.value,
        nullable=False,
    )
    billing_interval = db.Column(
        db.Enum(BillingInterval, values_callable=lambda x: [e.value for e in x], native_enum=False),
        default=BillingInterval.ANNUAL.value,
        nullable=False,
    )
    active = db.Column(db.Boolean, default=True, nullable=False)

    price_history = db.relationship("ServicePriceHistory", backref="service", lazy="dynamic", cascade="all, delete-orphan")


class Customer(TimestampMixin, db.Model):
    __tablename__ = "customers"

    id = db.Column(db.Integer, primary_key=True)
    company = db.Column(db.Text, nullable=False)
    website = db.Column(db.Text, default="")
    vat = db.Column(db.Text, default="")
    first_name = db.Column(db.Text, default="")
    last_name = db.Column(db.Text, default="")
    email = db.Column(db.Text, nullable=False)
    phone = db.Column(db.Text, default="")
    billing_address = db.Column(db.Text, default="")
    pec = db.Column(db.Text, default="")
    sdi = db.Column(db.Text, default="")
    status = db.Column(db.String(32), default="lead", nullable=False)
    wp_user_id = db.Column(db.BigInteger)

    jobs = db.relationship("Job", backref="customer", lazy="dynamic", cascade="all, delete-orphan")
    subscriptions = db.relationship("Subscription", backref="customer", lazy="dynamic", cascade="all, delete-orphan")
    debt_items = db.relationship("DebtItem", backref="customer", lazy="dynamic", cascade="all, delete-orphan")
    invites = db.relationship("Invite", backref="customer", lazy="dynamic", cascade="all, delete-orphan")
    notes = db.relationship("CustomerNote", backref="customer", lazy="dynamic", cascade="all, delete-orphan")

    __table_args__ = (db.Index("ux_customers_email", db.func.lower(email), unique=True),)


class Invite(db.Model):
    __tablename__ = "invites"

    id = db.Column(db.Integer, primary_key=True)
    customer_id = db.Column(db.BigInteger, db.ForeignKey("customers.id", ondelete="CASCADE"), nullable=False)
    token = db.Column(db.Text, unique=True, nullable=False)
    status = db.Column(db.String(32), default="pending", nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    completed_at = db.Column(db.DateTime)


class Job(TimestampMixin, db.Model):
    __tablename__ = "jobs"

    id = db.Column(db.Integer, primary_key=True)
    customer_id = db.Column(db.BigInteger, db.ForeignKey("customers.id", ondelete="CASCADE"), nullable=False)
    title = db.Column(db.Text, nullable=False)
    notes = db.Column(db.Text, default="")
    description = db.Column(db.Text, default="")
    due_date = db.Column(db.Date)
    start_date = db.Column(db.Date)
    amount = db.Column(db.Numeric(12, 2), default=0, nullable=False)
    payment_status = db.Column(db.String(32), default="pending", nullable=False)
    status = db.Column(
        db.Enum(JobStatus, values_callable=lambda x: [e.value for e in x], native_enum=False),
        default=JobStatus.QUALIFICAZIONE_PREVENTIVO.value,
        nullable=False,
    )

    services = db.relationship("Service", secondary="job_services", lazy="joined")
    job_notes = db.relationship("JobNote", backref="job", lazy="dynamic", cascade="all, delete-orphan")


class Subscription(TimestampMixin, db.Model):
    __tablename__ = "subscriptions"

    id = db.Column(db.Integer, primary_key=True)
    customer_id = db.Column(db.BigInteger, db.ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True)
    job_id = db.Column(db.BigInteger, db.ForeignKey("jobs.id", ondelete="SET NULL"), index=True)
    service_id = db.Column(db.BigInteger, db.ForeignKey("services.id"), nullable=False)
    purchase_date = db.Column(db.Date, nullable=False)
    renewal_date = db.Column(db.Date)
    billing_type = db.Column(
        db.Enum(BillingType, values_callable=lambda x: [e.value for e in x], native_enum=False),
        default=BillingType.ONE_TIME.value,
        nullable=False,
    )
    billing_interval = db.Column(
        db.Enum(BillingInterval, values_callable=lambda x: [e.value for e in x], native_enum=False),
        default=BillingInterval.ANNUAL.value,
        nullable=False,
    )
    price_at_sale = db.Column(db.Numeric(12, 2), default=0, nullable=False)
    status = db.Column(db.String(32), default="active", nullable=False)
    payment_status = db.Column(
        db.Enum(PaymentStatus, values_callable=lambda x: [e.value for e in x], native_enum=False),
        default=PaymentStatus.PENDING.value,
        nullable=False,
    )
    notes = db.Column(db.Text, default="")
    last_paid_at = db.Column(db.Date)

    service = db.relationship("Service", lazy="joined")

    __table_args__ = (
        db.Index("ix_subscriptions_renewal", "renewal_date"),
    )


class Ticket(TimestampMixin, db.Model):
    __tablename__ = "tickets"

    id = db.Column(db.Integer, primary_key=True)
    customer_id = db.Column(db.BigInteger, db.ForeignKey("customers.id", ondelete="SET NULL"))
    subject = db.Column(db.Text, nullable=False)
    message = db.Column(db.Text, nullable=False)
    status = db.Column(
        db.Enum(TicketStatus, values_callable=lambda x: [e.value for e in x], native_enum=False),
        default=TicketStatus.OPEN.value,
        nullable=False,
    )


class DebtItem(TimestampMixin, db.Model):
    __tablename__ = "debt_items"

    id = db.Column(db.Integer, primary_key=True)
    customer_id = db.Column(db.BigInteger, db.ForeignKey("customers.id", ondelete="CASCADE"), nullable=False)
    source_type = db.Column(db.String(32), default="job", nullable=False)
    source_id = db.Column(db.BigInteger)
    item_type = db.Column(db.String(32), default="one_time", nullable=False)
    label = db.Column(db.Text, nullable=False)
    due_date = db.Column(db.Date)
    amount_total = db.Column(db.Numeric(12, 2), default=0, nullable=False)
    amount_paid = db.Column(db.Numeric(12, 2), default=0, nullable=False)
    status = db.Column(db.String(32), default="open", nullable=False)

    payment_entries = db.relationship("PaymentEntry", backref="debt_item", lazy="dynamic", cascade="all, delete-orphan")

    __table_args__ = (
        db.CheckConstraint("source_type in ('subscription', 'job', 'manual')", name="ck_debt_source_type"),
        db.CheckConstraint("item_type in ('subscription', 'one_time')", name="ck_debt_item_type"),
        # Unique only for job source to avoid duplicate debt per job.
        # Subscriptions can have multiple historical debt items (one per renewal cycle).
        db.Index(
            "ux_debt_job_source",
            "source_type",
            "source_id",
            unique=True,
            postgresql_where=db.text("source_type = 'job' AND source_id IS NOT NULL"),
        ),
    )


class PaymentEntry(db.Model):
    __tablename__ = "payment_entries"

    id = db.Column(db.Integer, primary_key=True)
    debt_item_id = db.Column(db.BigInteger, db.ForeignKey("debt_items.id", ondelete="CASCADE"), nullable=False, index=True)
    customer_id = db.Column(db.BigInteger, db.ForeignKey("customers.id", ondelete="SET NULL"))
    date = db.Column(db.Date, nullable=False)
    amount = db.Column(db.Numeric(12, 2), default=0, nullable=False)
    note = db.Column(db.Text, default="")
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    __table_args__ = (
        db.CheckConstraint("amount > 0", name="ck_payment_amount_positive"),
    )


class CustomerContact(TimestampMixin, db.Model):
    __tablename__ = "customer_contacts"

    id = db.Column(db.Integer, primary_key=True)
    customer_id = db.Column(db.BigInteger, db.ForeignKey("customers.id", ondelete="CASCADE"), nullable=False)
    name = db.Column(db.Text, nullable=False)
    email = db.Column(db.Text)


class CustomerNote(db.Model):
    __tablename__ = "customer_notes"

    id = db.Column(db.Integer, primary_key=True)
    customer_id = db.Column(db.BigInteger, db.ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True)
    text = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class JobNote(db.Model):
    __tablename__ = "job_notes"

    id = db.Column(db.Integer, primary_key=True)
    job_id = db.Column(db.BigInteger, db.ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True)
    text = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class ServicePriceHistory(db.Model):
    __tablename__ = "service_price_history"

    id = db.Column(db.Integer, primary_key=True)
    service_id = db.Column(db.BigInteger, db.ForeignKey("services.id", ondelete="CASCADE"), nullable=False)
    old_price = db.Column(db.Numeric(12, 2), nullable=False)
    new_price = db.Column(db.Numeric(12, 2), nullable=False)
    note = db.Column(db.Text)
    changed_by = db.Column(db.BigInteger)
    changed_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class AuditLog(db.Model):
    __tablename__ = "audit_log"

    id = db.Column(db.Integer, primary_key=True)
    actor_user_id = db.Column(db.BigInteger)
    action = db.Column(db.Text, nullable=False)
    entity_type = db.Column(db.Text, nullable=False)
    entity_id = db.Column(db.Text)
    before_json = db.Column(db.JSON)
    after_json = db.Column(db.JSON)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class JobService(db.Model):
    __tablename__ = "job_services"

    id = db.Column(db.Integer, primary_key=True)
    job_id = db.Column(db.BigInteger, db.ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False)
    service_id = db.Column(db.BigInteger, db.ForeignKey("services.id"), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    __table_args__ = (db.UniqueConstraint("job_id", "service_id", name="ux_job_service"),)


class AdminUser(db.Model):
    __tablename__ = "admin_users"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.Text, nullable=False, unique=True)
    password_hash = db.Column(db.Text, nullable=False)
    name = db.Column(db.Text, default="")
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class Notification(db.Model):
    __tablename__ = "notifications"

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.Text, nullable=False)
    message = db.Column(db.Text, default="")
    notif_type = db.Column(db.String(32), default="info", nullable=False)  # info, warning, danger
    read = db.Column(db.Boolean, default=False, nullable=False)
    customer_id = db.Column(db.BigInteger, db.ForeignKey("customers.id", ondelete="SET NULL"))
    subscription_id = db.Column(db.BigInteger, db.ForeignKey("subscriptions.id", ondelete="SET NULL"))
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
