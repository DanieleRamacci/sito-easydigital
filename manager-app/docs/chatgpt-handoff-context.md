# ChatGPT Handoff Context Pack

Use this file as context when asking for the definitive implementation.

## Mandatory Inputs
- Current code reference: `manager-app/server.js`
- Functional/technical blueprint: `manager-app/docs/definitive-project-blueprint.md`
- Target DB schema: `manager-app/docs/postgres-schema-v1.sql`

## What Must Be Preserved
- Italian admin UI labels/wording.
- Existing status lifecycle (`qualificazione_preventivo` .. `chiusa_persa`).
- Notes diary behavior (locked notes editable via explicit button).
- Service pricing snapshot (`price_at_sale`) independent from list price changes.

## What Must Be Upgraded
- JSON storage -> PostgreSQL with migrations.
- Strict validation and transaction-safe updates.
- Financial consistency across customer/activity/debt views.
- Automated tests for critical payment and sync scenarios.

## Non-Negotiable Rules
1. Activity payment is not a global job flag.
2. Payments are managed on service/debt entries.
3. Activity amount is computed from selected services.
4. Service list price updates never mutate historical sold prices.
5. Customer and activity payment views must always show the same underlying state.

## Suggested Implementation Order
1. Domain + migrations + repositories.
2. Payment/debt module with tests.
3. Activity-service synchronization module with tests.
4. Service price history module.
5. UI routes/components migration.
6. Import pipeline migration.
7. Regression and reconciliation suite.

## Definition of Done
- All blueprint acceptance criteria pass.
- No financial mismatch between views.
- Migration scripts + rollback documented.
- CI includes integration tests against PostgreSQL.
