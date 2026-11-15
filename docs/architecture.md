# Lastro architecture

Lastro is a self-hosted, agent-first financial platform. A `Book` is the
mandatory scope for personal, family, property, project or business finances.
PostgreSQL is the source of truth. The primary interface is an MCP server for
agents; a compact web app provides review and direct operation.

The decisions in force are in [adr/](adr/README.md). The model is mapped in
[data-model.md](data-model.md), the vocabulary in
[domain-dictionary.md](domain-dictionary.md), and every table in the generated
[data-dictionary.md](data-dictionary.md), with
[diagrams](diagrams/lastro-data-model.html). Regenerate the last two with
`python3 docs/diagrams/generate-schema-docs.py` and
`python3 docs/diagrams/generate.py`.

## Purpose

The domain separates economic facts from cash movements:

```text
Expense != Payment
Revenue != Receipt

Expense 1 -- N ExpenseSettlement N -- 1 Payment
Revenue N -- N Receipt via RevenueSettlement
```

## Invariants

- Money is a `bigint` in the currency's minor unit with an explicit currency.
  JSON boundaries carry amounts as validated decimal strings.
- Every operation runs in one authenticated Book, and every reference carries
  the Book in its key, so no record points into another.
- A settlement connects records of one Book and one currency and carries its
  item's sign. An item is negative exactly when its financial category, or
  that category's group, has the `DEDUCTION` role (ADR 6).
- Active settlements never exceed their expense or revenue: both state
  their amount (ADR 20). Payments and receipts are the
  signed sum of their active settlements and never negative: writers insert the
  positive share first and void a deduction first.
- Status is derived from active settlements and paid dates, never set
  directly (ADR 5). Settlements are voided and replaced, never edited.
- A transfer is neither an expense nor a revenue.
- Every write runs in one transaction with its audit event, and is idempotent
  by key.
- Importers never silently infer economic facts (ADR 13): a file's evidence is
  reviewed before it becomes a record.

The rules that read other rows live in each module's `triggers.sql`, because a
rule the application alone enforces is a rule two concurrent callers can get
around. The application states the same rules first, so a caller learns which
field to fix.

## Modules

```text
packages/kernel   value types; defineOperation, defineModule, composeModules; the failure mapper
packages/host     the module list, composition over one connection, the single generated init
packages/config   validated environment configuration
packages/testing  fitness tests, the integration suite, the smoke test

modules/core      users and sessions, Books and membership, agent credentials,
                  audit events, idempotency records, the write envelope
modules/finance   institutions, accounts, billing windows, parties, financial categories;
                  expenses, payments, revenues, receipts, settlements, transfers; imported evidence
modules/sales     product categories, products, sale evidence and lines, sales days
modules/finance-imports  parsers of bank, card and acquirer statements; no tables
modules/sales-imports      parsers of point-of-sale sales reports; no tables
modules/close     the daily close, read from sales and finance; no tables

apps/api          the HTTP adapter; hosts Better Auth
apps/mcp          the MCP adapter, Streamable HTTP and stdio
apps/web          the shell, and each module's screens under src/modules/<id>
```

Each business module owns a vertical slice (ADR 11): its domain rules, zod
contracts, use cases, its own persistence port, its tables and triggers, its
operations, and its screens in the web app. Each `modules/<id>/README.md` is
that module's reference: public interface, operations, tables, invariants.

Dependencies point one way:

```text
kernel ← core ← finance ← finance-imports
              ← sales   ← sales-imports
         finance, sales ← close
```

A module reaches another only through that module's package root (its public
interface) or its `/contracts`, and only after declaring the dependency in its
manifest and its `package.json`. A module's tables reference only its own and
its dependencies' tables. Fitness tests enforce all of it, for imports and
foreign keys (`packages/testing/src/fitness.test.ts`) and for the web modules
and the shell (`apps/web/src/__tests__/modules-architecture.test.ts`).

Finance and sales do not know each other (ADR 11). Sales records what sold
and recognizes no revenue: a day's revenue comes from the payments report the
statement imports stage in finance (ADRs 7 and 19). The daily close, which
needs both, is the `close` module.

Every module but `core` is optional. The fitness test composes the host
without each module and whatever depends on it, and the web registry leaves
out a module's screens, actions and proxy routes with it.

**Contributions.** A module extends one it depends on through its manifest:
`contributes: { "finance-imports": [parser] }`. Composition gathers the
contributions before creating any module and hands each receiver its own in
`create({ contributions })`; the receiver checks every item and refuses a
malformed one at start-up. That is how a parser in its own package reaches
an import module ([extending/adding-an-import-flow.md](extending/adding-an-import-flow.md)).

Adding a module edits no other module: a package, one line in
`packages/host/src/modules.ts`, one line in `apps/web/src/modules/index.ts`.
[adding-a-module.md](extending/adding-a-module.md) is the procedure.

## The three seams

**Operation.** A module declares each capability once with `defineOperation`:
id, access (`read`, `write`, `admin`), whether it is destructive, input and
output schemas, HTTP method and path, MCP tool name and description (ADR 12).
The descriptor is browser-safe. The HTTP adapter, the MCP adapter, the web
client and the web proxy allowlist are all derived from the list of
descriptors; none names an operation. A capability therefore cannot exist on
one surface and be missing or different on another, and an agent never has
less reach than the web app.

**Write envelope.** `core` runs every operation. For a Book operation it reads
the caller's role from `book_members` (a context's claimed role is ignored),
refuses what that role does not reach, and for a write opens one transaction,
answers a replayed idempotency key with the stored result, runs the module's
handler, inserts the audit events it recorded, stores the result under the key
and commits. A write that records no audit event is refused as a defect.
Modules never open transactions or write audit and idempotency rows.

**Port.** A module's use cases reach storage only through its own
`application/port.ts`. Every member is required, so an adapter that cannot
answer one does not typecheck. Every member takes the scope's handle first, so
a call one module makes into another runs on the same transaction. An
in-memory adapter of each port, in each module's `testing.ts`, lets use cases
run through the real envelope without PostgreSQL.

`host.execute(operationId, context, input)` is the one entry: it validates the
context and the input, runs the handler inside the envelope, converts the
result to its wire shape and validates it against the descriptor's output
schema. One mapper (`toFailure`) turns any failure into a status, code,
message and details for both surfaces; a trigger's refusal keeps the words it
was written with, and an unexpected error is a 500 whose message is withheld.

## Surfaces

**HTTP** (`apps/api`). A Book operation is `/v1/books/:bookId<path>`, a user
operation `/v1<path>`. Input is the query string for a GET and the JSON body
otherwise, with path parameters merged in. The idempotency key is the
`Idempotency-Key` header. Callers authenticate with a Better Auth session
cookie or an agent's `Bearer <credentialId>.<secret>`.

**MCP** (`apps/mcp`). One server per composed module, at `/mcp/<module>`
over Streamable HTTP, or one module over stdio (`MCP_MODULE`). An agent
connects to the modules it uses, so each server lists only that module's
tools; `/mcp` itself answers the list of endpoints. One tool per operation,
its schema the operation's input
plus three transport fields: `bookId` (optional; must be the credential's
Book), `idempotencyKey` (required on writes) and `confirmation: "confirm"`
(required on destructive tools, which otherwise answer that confirmation is
needed). Refusals carry the code, status, details and the rule's own words.
A credential is bound to one Book and acts as one member of it. Tools never
accept SQL, ORM filters or another Book's id.

**Web** (`apps/web`). The shell owns the session, Book selection, layout and
navigation, and knows no module. Each web module registers its views, the
counters it loads itself, the operations its screens call, and the actions it
adds to another module's views. One client calls any operation by its
descriptor and validates the answer with the descriptor's output schema; the
proxy at `/api/backend` attaches the session cookie server-side and forwards
only the operations the registered modules declare. A catalog that is plain
list, create, update and delete is a declaration over the shell's generic
resource screen. Every evidence family's review (staged lines by state;
classify, post, ignore, undo) is the shell's evidence screen, given the
module's operations, columns and classify dialog; the upload on it is an
action the import module adds, so the review screen never names its importer.
Each module groups its entries in the navigation: Lançamentos, Importações,
Cadastros.

The interface is quiet and dense: a review surface for a ledger an agent
writes, not a dashboard competing for attention. Layout carries the
hierarchy. Money is set in `tabular-nums`. Colour never carries a status on
its own; every state is also named in text. Each open form keeps one
idempotency key across the operator's retries. Selected MIT-licensed
shadcn/ui primitives are copied into `apps/web/src/components/ui`, attributed
in `THIRD_PARTY_NOTICES.md`.

## Persistence

Each module owns its tables (`src/db/schema.ts`) and its hand-written rules
(`src/db/triggers.sql`). `bun run db:regenerate` builds the single
`packages/host/drizzle/0000_init.sql` from every module, appending the trigger
files in module order. There is one init by design: Lastro ships a database it
creates, not one it upgrades. `db-init` applies it once and records it by file
name, so a changed init reaches an existing installation only by recreating
the database (`docs/operating/runbook.md`), with the owner's explicit authorization.

A module never adds a column to another module's table, and never writes
another module's rows except through that module's operations or public
interface.

## Technology baseline

- Bun workspaces and Turborepo, strict TypeScript, Biome.
- Hono for the HTTP adapter; the official MCP TypeScript SDK for stdio and
  Streamable HTTP.
- PostgreSQL 16 and Drizzle ORM; locking and invariants are explicit SQL.
- Next.js 16 and React 19 for the web app, Tailwind CSS and Radix primitives.
- Better Auth for user sessions; core's revocable credentials for agents.
- No Redis, Supabase, GraphQL or separate queue.

## Testing

| Layer | Where | Runs in |
|---|---|---|
| Domain rules | each module's `src/domain/*.test.ts` | `bun run check` |
| Operations through the real envelope, over memory ports | each module's `src/application/*.test.ts` | `bun run check` |
| Adapters against real descriptors | `apps/api/src/app.test.ts`, `apps/mcp/src/server.test.ts` | `bun run check` |
| Screens, client, proxy allowlist | `apps/web/src/__tests__` | `bun run check` |
| Fitness: imports, foreign keys, manifests, web modules | `packages/testing/src/fitness.test.ts`, `apps/web/src/__tests__/modules-architecture.test.ts` | `bun run check` |
| Triggers, transactions, concurrency, HTTP/MCP parity | `packages/testing/src/integration/*.integration.ts` | `bun run test:integration` |
| Install path end to end | `packages/testing/src/smoke.ts` | `bun run smoke` |

Each fitness rule is proven against a fixture that breaks it.

Regression scenarios the suites keep: one expense paid in three installments;
one payment settling two expenses; a discount settled beside its expense; a
revenue received in parts; a transfer without an expense or revenue; a
cross-Book reference refused; two concurrent settlements competing for what
remains; a repeated idempotency key returning the first result; a settlement
voided and replaced; a day's sales imported and posted by product; a day's
payments report posted as its gross, discount, tip and acquirer fee; an
acquirer's deposit and its bank line meeting in one receipt that settles
the day's sales.

## Imports

Files arrive as evidence (ADR 13). An import module, `finance-imports` or
`sales-imports`, holds the parsers: pure functions from a file's text to
observations. The receiving module, finance or sales, owns the file ledger,
the staged movements, their descriptors and their posting. Each flow is
documented in [flows/](flows/README.md); a new one follows
[extending/adding-an-import-flow.md](extending/adding-an-import-flow.md).
Open work is in [ROADMAP.md](../ROADMAP.md).

## Non-goals

- No universal `transactions` table, and no bare `categories` table.
- No complete tax engine.
- No MCP access to SQL, the ORM or direct database mutation.
- No inference of what a line is from its wording: the descriptor decides (ADR 16).
- No mobile client before the web, API and MCP contracts are stable.
