# Domain dictionary

Normative business modeling conventions, reviewed on November 13, 2026, after
the move to business modules (ADR 11). The
[physical dictionary](data-dictionary.md) is generated from the schema and
lists every column, nullability rule, foreign key, index, CHECK and trigger, by
module. Each module's README states its rules; the
[model map](data-model.md) shows how they connect. A schema change updates the
owning module's README and regenerates the physical dictionary. Documentation
uses English; code identifiers, wire enums and vendor file headers keep their
actual values.

## Vocabulary

### Architecture

| Term | Meaning | Where |
|---|---|---|
| Module | A package that owns one business area end to end: rules, contracts, use cases, port, tables, triggers, operations; its screens live in the web app | `modules/<id>`, `apps/web/src/modules/<id>` |
| Manifest | A module's declaration: id, the modules it depends on, its operations and how to build it | `modules/<id>/src/index.ts` |
| Operation | One capability declared once: id, access, destructive or not, input and output schemas, HTTP route, MCP tool | `defineOperation` in a module's `contracts/` |
| Host | All modules composed over one connection, in dependency order | `packages/host` |
| Write envelope | Core's wrapper around every operation: role from Book membership, one transaction, idempotent replay, audit events | `modules/core/src/application/envelope.ts` |
| Scope | What a handler runs in: the caller's context, the transaction handle, and a way to record audit events. A cross-module call passes it on | `Scope` in `packages/kernel` |
| Port | A module's own persistence interface; every member required, each taking the scope's handle | `modules/<id>/src/application/port.ts` |
| Importer | A parser registered by id and version; its identity adds a fingerprint of its configuration, and the receiving module stores it with each file (ADR 13) | `createImporterRegistry` in `packages/kernel`, parsers in `modules/*-imports/src/parsers` |

### Core

| Term | Meaning | Table |
|---|---|---|
| Book | Ownership and authorization scope; every business record belongs to one | `books` |
| Member | A user's role in a Book: `OWNER`, `ADMIN`, `EDITOR` or `VIEWER` | `book_members` |
| Agent credential | A principal acting for one member of one Book; its role is that member's, resolved per request | `agent_credentials` |
| Audit event | Append-only record of a write: who, through which operation, what | `audit_events` |
| Idempotency key | A caller's key for one intended write; a replay answers with the first result | `idempotency_records` |

Access levels: `read` (every member), `write` (OWNER, ADMIN, EDITOR), `admin`
(OWNER, ADMIN).

### Finance

| Term | Meaning | Table |
|---|---|---|
| Institution | Financial institution or platform | `institutions` |
| Account | Money or an instrument the Book controls (ADR 8) | `accounts` |
| Billing window | A card invoice's purchase dates | `account_cycles` |
| Party | A person or company on the other side of a record | `parties` |
| Financial category | The chart of accounts, two levels; never called just "category" | `financial_categories` |
| Expense | What the Book owes | `expenses` |
| Payment | Money leaving an account; groups expense settlements | `payments` |
| Revenue | What the Book earned, including negative deductions | `revenues` |
| Receipt | Money arriving in an account; groups revenue settlements | `receipts` |
| Settlement | A signed allocation between an item and a payment or receipt | `expense_settlements`, `revenue_settlements` |
| Transfer | One event between two accounts the Book controls | `transfers` |
| Consumer | Which importer reads one account's content of one type; picked by Book, account and type when content is imported (ADR 14) | `movement_consumers`, `sale_consumers` |
| Statement file | One file taken into an account, identified by its content hash and importer identity | `movement_files` |
| Movement | One statement line: a payment movement took money out, a receipt movement brought it in; PENDING, POSTED or IGNORED | `payment_movements`, `receipt_movements` |
| Descriptor | A counterparty name on one account's statements, keyed by its normalization (`descriptor_key`), classified once as a party and financial category or as a transfer with another account, optionally with a payment method; its lines post themselves (ADR 17) | `payment_movement_descriptors`, `receipt_movement_descriptors` |
| Revenue movement | One payment method (or product and brand) of one day, from the point of sale or the acquirer: gross, discount, fee, acquirer fee, amount to receive; up to four revenues, and never a receipt (ADR 19) | `revenue_movements` |
| External key | `a<account>-<external id>`: shared by every link of one movement, the way to its group (ADR 19) | `*_links.external_key`, `revenue_movement_links.external_key` |
| Card line | One instalment line of a card invoice, staged with its expense key (the purchase) and payment key (the instalment) (ADR 18) | `card_movements` |
| Instalment link | One instalment of a card purchase: its invoice payment and settlement, and the line that showed it | `card_movement_payments` |
| Movement link | One record a posted movement became: a transfer, or an expense and payment (revenue and receipt) | `payment_movement_links`, `receipt_movement_links` |
| Statement key | `<from>-<METHOD>-<to>-YYYYMMDD-<amount>` on a link, ends `a<account>` or `p<party>`; both statements of one transfer compute the same key, which is how the second side joins it (ADR 17) | `*_movement_links.statement_key` |

### Sales

| Term | Meaning | Table |
|---|---|---|
| Product category | The tree of what the Book sells, one level; never called just "category" | `product_categories` |
| Product | Something the Book sells, with an optional unit cost the Book stands behind | `products` |
| Business day | The operational day [06:00, next 06:00), America/Sao_Paulo | `business_date` columns |
| Sale movement | One product of one day as the point of sale printed it; PENDING, POSTED or IGNORED (ADR 21) | `sale_movements` |
| Sale descriptor | A point-of-sale product code and the Book's product it always is | `sale_movement_descriptors` |
| Sale link | What a posted sale movement became: its line, keyed `<external key>-sale` | `sale_movement_links` |
| Sales day | A business day with posted sale lines, derived from them | `sales` |
| Sale line | One product's quantity, revenue and cost on a posted day | `sales` |
| Daily close | A posted day's derived result; never stored | computed by `close.getDailyClose` |

An expense is not a payment and a revenue is not a receipt (ADR 2). There is no
`transactions` table. Status is derived from active settlements, never stored
(ADR 5). There are no receivables: revenue no receipt has settled yet is still
to be received (ADR 7).

## Names, units and types

- Tables are plural English nouns in `snake_case`, with no exception:
  Better Auth's models are the `auth_users`, `auth_sessions`, `auth_accounts`
  and `auth_verifications` tables. An `auth_accounts` row is a sign-in method,
  not a financial account. CONTRIBUTING.md's "Names" has every layer's rule.
- A category is named by what it classifies: `financial_categories`,
  `product_categories`, `financial_category_id`, `product_category_id`. A bare
  `category` is never an identifier.
- SQL columns use `snake_case`; TypeScript properties use `camelCase`. Foreign
  keys use `<entity>_id` and include `book_id`, so no reference crosses Books.
- `amount`: BIGINT in the currency's minor unit (cents for BRL). Domain values
  are `bigint`; JSON values are decimal integer strings. Quantities and counts
  are not money: exact decimal text. Never use `number` or floating point for
  money.
- Signed amounts: an item is negative exactly when its financial category, or
  that category's group, has the `DEDUCTION` role (ADR 6). A settlement
  carries its item's sign; a payment or receipt is the signed sum of its active
  settlements and never negative.
- `currency`: a three-letter ISO code, usually `BRL`.
- `_on`: DATE, JSON `YYYY-MM-DD`, never an invented time. `_at`: TIMESTAMPTZ,
  ISO JSON with a zone. `due_on` and `paid_on` are known dates; `due_at` and
  `paid_at` are actual instants. Unknown values are null. `reference_month`
  (competence) and `business_date` are DATE exceptions to the suffix rule.
- `payment_method` is how money moved: `PIX`, `BOLETO`, `TRANSFER`,
  `DEBIT_CARD`, `CREDIT_CARD`.
- Operation ids are `<module>.<camelCaseName>`; MCP tools are `snake_case`;
  HTTP paths are under `/v1/books/:bookId` for Book operations.

## Idempotency and transactions

Every write runs in one transaction opened by the write envelope: the module's
rows, any module it calls, the audit events and the idempotency record commit
together or not at all.

A write may carry an idempotency key: the `Idempotency-Key` header over HTTP,
the `idempotencyKey` field over MCP (required there). The first call stores the
wire result under `(book_id, key)`; a replay with the same key and operation
answers with that result and writes nothing. The same key for another
operation is a conflict. An advisory lock per key serializes concurrent
callers. A key names one intended write, not an operation: two different
records written by one script need two keys.

Writers that recompute a derived amount take advisory locks before inserting
or voiding a settlement: the item first, then the payment or receipt.

## Sales evidence and posted days

A posted day's input is provider-neutral: product lines (product, quantity,
revenue, and the cost the point of sale reported, when it did). A line's cost
is the product's `cost_override` when set (`CATALOG`), else the reported cost
(`SALE`), else `MISSING`. A line is what a posted sale movement became
(ADR 21); it recognizes no revenue, and undoing the movement deletes it.

## File evidence

Files arrive as evidence (ADR 13). A parser in `finance-imports` or
`sales-imports` returns observations; the receiving module owns each file's
identity, its provenance (the importer's id, version and configuration
fingerprint), staging and posting. A line becomes a movement and posts itself
when its descriptor is filled (ADRs 16 and 17). Each flow is documented in
`docs/flows/`, from `docs/flows/TEMPLATE.md`.
