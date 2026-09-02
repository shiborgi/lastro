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

Expense N -- N Payment via ExpenseSettlement
Revenue N -- N Receipt via RevenueSettlement
```

## Invariants

- Money is represented as `bigint` minor units with an explicit currency. JSON
  boundaries carry minor units as validated decimal strings.
- Every financial command and query receives an authenticated `bookId`.
- A settlement may connect only records from the same Book and currency.
- Active settlements may not exceed either related record's available amount.
- Financial status is derived from active settlements and is never set directly.
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
apps/api       authenticated HTTP/JSON API
apps/mcp       stdio and Streamable HTTP MCP adapter
apps/worker    imports and recurring jobs

packages/domain          framework-independent entities and invariants
packages/application     commands, queries, authorization, and ports
packages/db              PostgreSQL migrations and port implementations
packages/contracts       Zod schemas for API, MCP, and events
packages/auth            sessions, agent credentials, RBAC, and Book resolution
packages/banking         provider and import contracts
packages/ui              shared React design system
packages/observability   structured logs, metrics, and tracing
packages/config          validated environment configuration
packages/testing         fixtures and PostgreSQL test support
```

API, MCP, web, and worker adapters invoke the same application handlers. Domain
rules do not live in routes, MCP tools, jobs, or React components. Persistence is
accessed through application ports; only `packages/db` knows Drizzle, SQL, locks,
and migrations.

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
- Bun-hosted Hono services for API, MCP, and worker processes.
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
read tools include `list_books`, `get_book_position`, `list_expenses`,
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

Validation covers both a generic MCP v2 client and the local virtual-agent path:

```text
Bartender/OpenCode -> Barback -> Lastro Streamable HTTP MCP
```

Barback registration remains deny-by-default, uses an environment-provided bearer
credential, and explicitly classifies every exposed tool as read or write.

## Web Experience

The interface combines Midday's compact, data-first organization with a functional
8-bit visual language inspired by <https://github.com/TheOrcDev/8bitcn-ui>.
Selected MIT-licensed registry components are copied into `packages/ui`; the full
upstream application is not added as a dependency. Source revision and attribution
are recorded in `THIRD_PARTY_NOTICES.md` when components are introduced.

The 8-bit language applies to the shell, pixel borders, hard shadows, navigation,
buttons, badges, dialogs, loading, and feedback. Financial tables, charts, forms,
and monetary values retain highly legible typography and tabular numerals. Color is
never the only status signal. The design avoids game metaphors for wealth and does
not use health, mana, or experience bars.

The first usable web surface contains a responsive Book selector, financial
position, pending obligations, cash flow, dense expense/payment tables, settlement
drawers, and agent/audit activity. It supports light and dark themes, keyboard
operation, visible focus, reduced motion, 360-pixel mobile layouts, and WCAG 2.2 AA
contrast.

## Persistence

The minimum model contains users, Books, members, financial accounts, parties,
separate expense and revenue categories, expenses, payments, expense settlements,
revenues, receipts, revenue settlements, transfers, audit events, and idempotency
records. Composite keys and foreign keys include `book_id` to enforce tenancy at the
database boundary.

## Delivery Order

1. Repository foundation, ADRs, PostgreSQL, verification, and deployment baseline.
2. Identity, Book membership, RBAC, accounts, parties, and separate categories.
3. Expense, payment, and ExpenseSettlement vertical slice with concurrency tests.
4. Authenticated API and read-only MCP validated by a generic client.
5. Minimal Next.js operator interface with the hybrid 8-bit design system.
6. Revenue, receipt, RevenueSettlement, transfers, position, and cash flow.
7. Confirmed MCP writes and end-to-end virtual-agent validation through Barback.
8. Bank imports, reviewable automation, recurring jobs, and operational hardening.

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
