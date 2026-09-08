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
apps/api       authenticated HTTP/JSON API, hosts Better Auth
apps/mcp       stdio and Streamable HTTP MCP adapter

packages/domain          framework-independent entities and invariants
packages/application     commands, queries, authorization, and ports
packages/db              PostgreSQL schema, migrations, and port implementations
packages/contracts       Zod schemas for API, MCP, and events
packages/auth            agent credentials, RBAC, and Book membership resolution
packages/config          validated environment configuration
packages/testing         fixtures and PostgreSQL test support
```

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

MCP is an adapter over application handlers, not a second financial API. Initial
read tools include `list_books`, `get_expense_position`, `list_expenses`,
`list_unpaid_expenses`, `list_payments`, `list_revenues`,
`list_unreceived_revenues`, `list_receipts`, and `get_cash_flow`.

Controlled write tools include `create_expense`, `create_payment`,
`settle_expense_with_payment`, `void_expense_settlement`, `create_revenue`,
`create_receipt`, `settle_revenue_with_receipt`, and `create_transfer`.

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

The home surface is a summary — outstanding expenses and revenues by currency,
cash flow, pending obligations — and each entity gets a tab: full CRUD for the
catalog, read surfaces for the financial cycle, which is written through the
settlement flows rather than edited in place.

Money is set in `tabular-nums` so columns of figures align on the digit, which
is what makes a dense table scannable. Colour never carries a status on its
own; every state is also named in text. The palette is near-monochrome, and the
few saturated tones are reserved for the two things worth interrupting a reader
for: a destructive action and a failed load.

The web surface contains a responsive Book selector, financial position,
pending obligations, cash flow, dense expense/payment tables, settlement
drawers, and agent/audit activity. It supports light and dark themes, keyboard
operation, visible focus, reduced motion, 360-pixel mobile layouts, and WCAG 2.2 AA
contrast.

## Persistence

The minimum model contains users, Books, members, financial accounts, parties,
separate expense and revenue categories, expenses, payments, expense settlements,
revenues, receipts, revenue settlements, transfers, audit events, and idempotency
records. Composite keys and foreign keys include `book_id` to enforce tenancy at the
database boundary.

## Roadmap

1.0 covers identity and Book membership, catalog CRUD across API and MCP, the
expense and revenue cycles with concurrency-tested settlement, transfers,
position and cash flow, confirmed MCP writes, and the operator interface.

Not yet built:

- Bank imports. A reviewable pipeline that turns provider movements into drafts
  without inferring economic facts. It lands with an entry point that a person
  or an agent can actually reach, not as tables nothing calls.
- Recurring jobs, on the same condition.
- Member management. `MANAGE_MEMBERS` exists in the RBAC matrix but no surface
  asserts it yet; membership is granted by `bun run bootstrap`.

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
