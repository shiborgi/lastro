# Lastro Architecture

This document is the repository source of truth derived from the project wiki at
<https://github.com/shiborgi/lastro/wiki>.

## Purpose

Lastro is a self-hosted, AI-assisted financial platform. A `Book` is the mandatory
scope for personal, family, property, project, or business finances. PostgreSQL is
the source of truth, and the primary interaction channel is an MCP server connected
to virtual agents. A compact web application provides direct operation and review.

The domain distinguishes economic facts from cash movements:

```text
Expense != Payment
Revenue != Receipt

Expense 1 -- N ExpenseSettlement N -- 1 Payment
Revenue N -- N Receipt via RevenueSettlement
```

## Invariants

- Money is represented as `bigint` amount with an explicit currency. JSON
  boundaries carry amount as validated decimal strings.
- Every financial command and query receives an authenticated `bookId`.
- A settlement may connect only records from the same Book and currency.
- An expense settlement is a scheduled installment. It carries its sequence and
  total number of installments; a payment may group installments from different
  expenses.
- Active settlements may not exceed their expense's total. A payment's amount is
  derived from the sum of its active settlements and is never entered directly.
- Expense status is derived from active settlements and is never set directly.
- Payments have a due date and may record their effective payment date.
- Confirmed settlements are voided and replaced, never edited in place.
- Revenue is the mirror image, not the copy: a revenue's amount is *derived*
  from its settlements, because an acquirer settles one day's sales in several
  lines and they are one earning. The receipt is the fixed figure there — one
  per statement line — so the cap that protects the revenue cycle is the
  receipt's own amount, enforced by `revenue_settlement_within_receipt`.
- Settlement creation locks affected rows and writes audit evidence in the same
  PostgreSQL transaction.
- Every mutation is idempotent and records an append-only `AuditEvent`.
- Internal transfers are not expenses, revenues, expense payments, or revenue
  receipts.
- Bank imports create reviewable cash movements or drafts and do not silently
  infer economic facts.

## Architecture

The TypeScript monorepo contains independent applications and shared packages:

```text
apps/web       Next.js operator interface
  src/components/review/   the descriptor benches and their inline forms
apps/api       authenticated HTTP/JSON API, hosts Better Auth
  src/routes/              one module per concern, composed by createApi
apps/mcp       stdio and Streamable HTTP MCP adapter
  src/tools/               catalog, financial and statement tool groups

packages/domain          framework-independent entities and invariants
  src/{authz,errors,money,catalog,financial,movements,audit}.ts
packages/application     commands, queries, authorization, and ports
  src/ports/               the persistence port, split by aggregate
  src/movements/           import, review, promotion, insights
  src/statements/          the bank-format plugins
packages/db              PostgreSQL schema, migrations, and port implementations
  src/schema/              tables by aggregate; triggers.sql holds the rest
packages/contracts       Zod schemas for API, MCP, and events
packages/auth            agent credentials, RBAC, and Book membership resolution
packages/config          validated environment configuration
packages/testing         fixtures and PostgreSQL test support
```

Persistence is reached through the port in `packages/application/src/ports`,
split by aggregate with every member required. `packages/testing` asserts at
compile time that the database adapter satisfies it, so the two cannot drift.

API, MCP, and web adapters invoke the same application handlers. Domain rules do
not live in routes, MCP tools, or React components. Persistence is accessed
through application ports; only `packages/db` knows Drizzle, SQL, locks, and
migrations.

Every application call carries:

```ts
type ExecutionContext = {
  actorId: string;
  bookId: string;
  role: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
  source: "WEB" | "API" | "MCP" | "WORKER";
  correlationId: string;
  idempotencyKey?: string;
};
```

## Technology Baseline

- Bun workspaces and Turborepo with strict TypeScript and Biome.
- Bun-hosted Hono services for the API and MCP processes.
- PostgreSQL and Drizzle ORM; critical locking and constraints remain explicit SQL.
- Next.js 16 and React 19 for the operator interface.
- Tailwind CSS, Radix primitives, and selected shadcn-compatible components.
- Better Auth for user sessions and service-principal credentials for agents.
- Official MCP TypeScript SDK v2 with stdio and Streamable HTTP transports.
- PostgreSQL-first jobs; no Redis, Supabase, GraphQL, or separate queue initially.
- Deterministic unit and contract tests, real PostgreSQL integration tests, and
  Playwright for essential web and agent flows.

## MCP

MCP is an adapter over application handlers, not a second financial API. The
surface is 55 tools: 27 named ones plus `list`/`create`/`update`/`delete` for
each of the seven catalog resources, generated from one description.

Read tools are `list_books`, `list_expenses`, `list_payments`,
`list_expense_settlements`, `get_expense_position`, `list_revenues`,
`list_receipts`, `list_revenue_settlements`, `get_revenue_position`,
`list_transfers`, and `get_cash_flow`.

Write tools are `create_expense`, `create_payment`,
`settle_expense_with_payment`, `void_expense_settlement`, `create_revenue`,
`create_receipt`, `settle_revenue_with_receipt`, `void_revenue_settlement`, and
`create_transfer`.

Statement tools are `import_statement`, `list_card_movements`,
`list_account_movements`, `review_movement`, `post_movement`,
`list_pending_card_descriptors`, and `list_pending_account_descriptors`.

Tools use strict schemas, bounded pagination, explicit Book selection, idempotency
keys, least-privilege scopes, and explicit confirmation for destructive or
low-confidence actions. They never accept SQL, arbitrary ORM filters, or a foreign
Book identifier. Audit identifies an `ASSISTANT` principal, the delegated operator,
and a correlation ID.

The tool surface is deliberately complete rather than read-biased: catalog CRUD
(institutions, accounts, parties, categories) is exposed alongside the financial
cycle, because an agent that cannot create the entities every record references
cannot open a Book and work. Anything the HTTP API can reach, a tool can reach.

Validation runs against a generic MCP client over both transports, asserting the
tool surface, the annotations, and that a destructive tool refuses to act
without confirmation.

## Web Experience

The interface is quiet and dense: a review surface for a ledger an agent
writes, not a dashboard competing for attention. Layout carries the hierarchy —
spacing, weight and rule lines — so no chrome has to. Selected MIT-licensed
shadcn/ui primitives are copied into `apps/web/src/components/ui`; the upstream
application is not added as a dependency, and attribution is recorded in
`THIRD_PARTY_NOTICES.md`.

Navigation is a collapsible left rail, not tabs. The home surface is *Resumo*:
the gaps still waiting on a decision, a daily cash series built from account
statements, and totals by group.

The rest of the rail follows the path a statement takes through the ledger.
*Revisão* is the bench where an operator maps the descriptors a bank file
introduced — one descriptor stands for every movement that shares its wording,
so the queue is ordered by how much each decision resolves, and party and
category can be created inline rather than sending the operator to Cadastro and
back. *Lançar* promotes the rows whose descriptors are now complete, grouping
what is ready and naming the reason for what is not. The three cycle screens —
expense, revenue, transfer — are read surfaces over what promotion produced,
each folding the settlement join into whichever side you opened. *Categorias*
is the two-level chart of accounts, and the catalog screens are full CRUD.

An undecided destination is drawn as a blank to fill, never an em dash: the
ledger does not assert what it does not know, and neither does the screen. The
institution's own wording is quoted behind a rule as somebody else's claim,
because a real invoice files "BRASTEMP BY CULLIGAN" under *Aluguel* and adopting
that would put a wrong fact on the books.

Money is set in `tabular-nums` so columns of figures align on the digit, which
is what makes a dense table scannable. Colour never carries a status on its
own; every state is also named in text. The palette is near-monochrome, and the
few saturated tones are reserved for the two things worth interrupting a reader
for: a destructive action and a failed load.

The web surface supports light and dark themes, keyboard operation, visible
focus, reduced motion, 360-pixel mobile layouts, and WCAG 2.2 AA contrast.

## Persistence

Twenty-five tables: Better Auth's four, then Books and membership, the catalog
(institutions, accounts, card billing windows, parties, card and account
descriptors, categories), the four financial records with their settlements,
transfers, the staged card and account movements, and the audit, idempotency and
agent-credential tables. Composite keys and foreign keys include `book_id` to
enforce tenancy at the database boundary.

Rules that a `CHECK` cannot express live in `packages/db/triggers.sql`, appended
to the single init migration because drizzle-kit emits no plpgsql: the two
settlement caps, the derived payment and revenue amounts, the two-level category
rule, and the billing windows that may not overlap. A rule the application alone
enforces is a rule two concurrent callers can get around.

## Roadmap

1.0 covers identity and Book membership, catalog CRUD across API and MCP, the
expense and revenue cycles with concurrency-tested settlement, transfers,
position and cash flow, confirmed MCP writes, the operator interface, and bank
statement import.

Import is a plugin per bank format — C6 card and account, Nubank account, over a
declarative CSV mapping — registered by the storage path
`<institution>/<kind>/<file>`. A plugin only parses: it never decides meaning
and never computes keys. Staging writes the rows as PENDING with a dedup key of
`sha256(institution, account, date, descriptor, amount)` plus an occurrence
number, which is what makes re-importing a file a no-op while keeping two
genuinely identical purchases apart. Promotion is separate and separately
authorized, and refuses rather than guesses when a descriptor names no party or
no category (ADR 8).

Not yet built:

- Recurring jobs, on the same condition as imports: an entry point a person or
  an agent can actually reach, not tables nothing calls.
- Member management. Membership is granted by `bun run bootstrap`; there is no
  surface for it, so the RBAC matrix no longer carries an operation that nothing
  asserts.
- Audit reads. Every mutation appends an `AuditEvent` and the integration suite
  reads them, but no route, tool or screen exposes them yet.

## Required Regression Scenarios

1. One expense paid in three installments.
2. One payment settling two expenses.
3. One expense settled by both instant payment and card.
4. One revenue received in parts.
5. One receipt settling salary and reimbursement revenues.
6. Internal transfer without expense or revenue creation.
7. Cross-Book settlement rejection.
8. Concurrent settlements competing for the remaining balance.
9. Repeated idempotency key returning the original result.
10. Settlement void followed by a replacement.

## Non-goals

- No universal `transactions` or universal `categories` table.
- No general ledger, chart of accounts, or complete tax engine in the initial cycle.
- No MCP access to SQL, ORM, or direct database mutation.
- No automatic conversion of imported movements into economic facts.
- No mobile client before the web, API, and MCP contracts are stable.
