# Easy Digital Agency CRM - Definitive Project Blueprint (v1)

Generated from current behavior and agreed business rules.
Target date: 2026-02-25

## 1) Goal
Build the definitive production CRM replacing JSON-file persistence with a real relational DB and strict validation, while preserving and stabilizing current workflows:
- Customer management
- Activities (jobs)
- Services linked to customers and activities
- Unified payments/acconti tracking on service/debt entries
- Renewals/subscriptions
- Tickets
- Import from CRM CSV

## 2) Core Product Rules

### 2.1 Activity vs Service
- An activity can have multiple linked services.
- Payment state is NOT a property of the activity; payment is tracked per economic item (service/debt entry).
- Activity status (pipeline phase) is operational only.

### 2.2 Service Pricing
- Service has `current list price`.
- When sold/assigned, the sold entry stores `price_at_sale` snapshot.
- Changing list price must never alter previously sold/paid entries.
- Price changes must be auditable via `service_price_history`.

### 2.3 Payment Module
- Payments are tracked against debt items with partial payments (acconti).
- For each item:
  - toggle pending/paid
  - register one or more partial payments with date/note
- Payment history must be visible under each item.
- Paid items appear in a collapsed section.

### 2.4 Scope Synchronization
- Customer page payment view: all service debt items for that customer.
- Activity page payment view: only service debt items linked to that activity.
- Any payment change in one scope must be visible in the other scope immediately (same underlying records).

### 2.5 Debts and Renewals Views
- Debts page:
  - open/pending debts in main table
  - paid debts in collapsed section
  - separate tab for subscription renewals ordered by due date

### 2.6 Dashboard Activity Buckets
- Main table: active operational statuses.
- Backlog collapse: `scrittura_preventivo`, `qualificazione_preventivo`.
- Closed collapse: `chiusa_acquisita`, `chiusa_persa`.

## 3) Domain Model

### 3.1 Entities
- users
- customers
- customer_contacts
- services
- service_price_history
- jobs (activities)
- job_services (many-to-many activity-service link)
- subscriptions (service sold/assigned entry, linked to customer and optional job)
- debt_items (economic ledger per source)
- payment_entries (partial/full payments)
- tickets
- invites
- imports

### 3.2 Payment Ledger Principle
- `subscriptions` and optional standalone one-time entries feed `debt_items`.
- `debt_items.amount_total` is immutable snapshot for the billed item.
- `payment_entries` accumulate paid amount.
- computed outstanding = `amount_total - sum(payment_entries.amount)`.
- pending/paid derived from outstanding with threshold (e.g. <= 0.009 => paid).

## 4) Activity Lifecycle

### 4.1 Create Activity
Required input:
- title
- customer_id
- status
- due_date (optional)
- description (optional)
- service_ids (0..N)

On create:
- persist `jobs`
- create/update `job_services`
- auto-sync service assignments into `subscriptions` with `job_id`
- compute `job.amount = sum(current service list prices of selected service_ids)`

### 4.2 Edit Activity
- add/remove services via explicit UI (+ add, list below, - remove)
- recompute amount from selected services
- re-sync linked subscriptions:
  - add missing service subscriptions
  - remove unselected subscriptions only when safe (no payments)
  - if paid history exists, mark cancelled instead of hard delete

## 5) UI Functional Spec

### 5.1 Activity Form (new/edit)
- Remove pipeline secondary field.
- Keep only status selector.
- Remove add-on/product blocks.
- Service selector must show service price in dropdown and selected list.
- Total amount read-only, auto-calculated from selected services.

### 5.2 Customer Detail
Tabs:
- Timeline
- Notes
- Activities
- Payments
- Ticket

Activities tab:
- quick create activity button
- direct service assignment block
- “Storico attività e servizi”: show activity list + service financial list

Payments tab:
- same service financial list focused on payment operations
- active/open items first
- paid items collapsed
- per-item payment history inline

### 5.3 Activity Detail
- customer name is a link to customer detail
- data tab with clear labels
- timeline tab
- notes diary tab (locked notes with explicit edit button)
- payment/debts tab shows only services linked to current activity

### 5.4 Debts Page
Two tabs:
- Debiti aperti (pending/open, with paid collapsed)
- Rinnovi abbonamenti (subscription renewals only, ordered by due date)

## 6) API and Validation Contract (target)

### 6.1 Services
- POST `/api/services`
- PATCH `/api/services/:id`
- POST `/api/services/:id/price`
Validation:
- `price >= 0`
- log all price updates to history

### 6.2 Jobs
- POST `/api/jobs`
- PATCH `/api/jobs/:id`
- PATCH `/api/jobs/:id/status`
Validation:
- status in enum
- service_ids unique and existing
- job amount is server-computed

### 6.3 Customer-Service Assignment
- POST `/api/customers/:id/assignments`
Creates subscription/debt item with snapshot price.

### 6.4 Payments
- POST `/api/debts/:id/payments`
- PATCH `/api/debts/:id/status` (pending/paid toggle)
Validation:
- amount > 0
- no overpayment unless explicit policy allows

### 6.5 Renewals
- PATCH `/api/subscriptions/:id/payment`
Rule:
- default behavior: explicit state persists.
- optional auto-rollover only for standalone recurring plans if explicitly enabled by business flag.

## 7) Data Integrity Rules
- FK constraints on all references.
- `job_services` unique `(job_id, service_id)`.
- `subscriptions` unique by `(customer_id, service_id, job_id)` for active row where applicable.
- Soft-delete/cancel states instead of hard delete when financial history exists.
- Monetary fields as numeric(12,2).
- UTC timestamps everywhere.

## 8) Security and Audit
- RBAC roles: administrator, operator, customer.
- All write operations require authenticated admin/operator.
- Audit table for critical mutations:
  - price updates
  - payment status toggles
  - manual debt edits
  - import operations

## 9) Migration Plan (from JSON store)
1. Export JSON store snapshot.
2. Load master entities: customers, services.
3. Load jobs and job-service links.
4. Load subscriptions with `price_at_sale`.
5. Rebuild debt items from subscriptions (and legacy one-time jobs if needed).
6. Load payment entries and recompute outstanding.
7. Verify counts and totals with reconciliation report.

## 10) Testing Matrix (must-pass)

### 10.1 Pricing
- Change service list price does not alter old sold entries.
- New assignment uses new list price.

### 10.2 Activity-Service Sync
- Add 2 services to activity -> both appear in activity and customer payment views.
- Remove unpaid service -> removed from both views.
- Remove paid service -> cancelled, retained in history.

### 10.3 Payments
- pending -> paid persists after save and reload.
- partial payments reduce outstanding correctly.
- payment recorded in history with date and note.

### 10.4 Visibility
- Customer page shows activity list and service financial list.
- Activity page shows only services linked to that activity.
- Debts page split works: pending main, paid collapsed, renewals tab sorted.

### 10.5 Regression
- creating customer inline during activity creation still works.
- note diary editing still locked/unlocked correctly.

## 11) Suggested Tech Stack for Definitive Build
- Backend: Node.js + TypeScript + Fastify (or NestJS)
- DB: PostgreSQL + Prisma/Drizzle migrations
- Auth: JWT with role claims from WP bridge or dedicated auth service
- Frontend: server-rendered or React admin panel
- Observability: structured logs + error tracking

## 12) Acceptance Criteria (project complete)
- No JSON file persistence for business data.
- All listed use-cases covered by automated tests.
- Financial totals reconcile across customer/activity/debts views.
- No payment state drift between pages.
- Production deployment guide and rollback plan documented.
