# Working on Lastro

Conventions live in [CONTRIBUTING.md](CONTRIBUTING.md) and the decisions in
force in [docs/adr/](docs/adr/README.md). This file is the short version. Open
work is in [ROADMAP.md](ROADMAP.md); each import flow is documented in
[docs/flows/](docs/flows/README.md), and a change to a flow updates its
document in the same commit.

## The gate

```bash
bun run check              # typecheck, lint, unit and fitness tests, builds, notice, secret and private-data scans
bun run test:integration   # Docker: the init, both adapters as deployed, real PostgreSQL
bun run smoke              # Docker: empty database to an agent over MCP and a web sign-in
```

`check` needs no Docker. Run `test:integration` when SQL changes, and `smoke`
when install, an adapter or the web app changes. Nothing is done until they
pass. Evidence before assertions: run the command, read the output.

## Modules

Code is organized by business module (ADR 11). Each `modules/<id>` package owns
its rules, contracts, use cases, port, tables, triggers and operations; its
screens live in `apps/web/src/modules/<id>`. Today: `core` (identity, Books,
credentials, audit, idempotency, the write envelope), `finance` (catalogs, the
four records, settlements, transfers, the evidence imports stage), `sales`
(products, the sale evidence and lines, the days derived from them), `close`
(the daily close, read from sales and finance; no tables), and the parsers of
`finance-imports` and `sales-imports`, which own no tables: the receiving
module stages what a file says (ADR 13). A parser from another package is a
module that contributes it to the import module (`contributes` in its
manifest). Each module's `README.md` is its reference.

- Dependencies point one way. `finance` and `sales` each depend only on
  `core` and know nothing of each other; `finance-imports` depends on
  `finance`, `sales-imports` on `sales`, and `close` on both. Every module
  but `core` is optional: the host composes without it and whatever depends
  on it (`packages/testing/src/fitness.test.ts`). A module
  reaches another only through that module's package root or `/contracts`,
  and only when its manifest's `dependsOn` and its `package.json` both name
  it. Fitness tests in `packages/testing` and `apps/web` fail otherwise,
  for imports and for foreign keys alike.
- Adding a module never edits another module:
  [docs/extending/adding-a-module.md](docs/extending/adding-a-module.md) is the procedure,
  and [docs/extending/adding-an-import-flow.md](docs/extending/adding-an-import-flow.md)
  for a new import flow.
- `packages/kernel` is pure shared value types and the module and operation
  definitions. `packages/host` is the composition root: the module list
  (`src/modules.ts`) and the single generated init.

## The three seams

- **Operation.** A capability is declared once with `defineOperation` in a
  module's `contracts/`. The HTTP and MCP adapters, the web client and the web
  proxy allowlist are derived from it; none of them names an operation.
- **Write envelope.** `core` runs every operation: membership-derived role,
  transaction, idempotent replay, audit. A module never opens a transaction,
  writes `audit_events` or touches idempotency itself, and a write that
  records no audit event is refused.
- **Port.** A module's use cases reach storage only through its own
  `application/port.ts`. Every member is required and takes the scope's
  handle first, so a cross-module call joins the caller's transaction.

A route, a tool or a component that decides a business outcome on its own is a
bug: rules live in a module, and its database triggers hold them for every caller.

## Money and records

Amounts are `bigint` in the currency's minor unit and cross the wire as decimal
strings. There is no floating point path anywhere and there should not be one.

An expense is not a payment and a revenue is not a receipt (ADR 2). Status is
derived from active settlements, never stored (ADR 5). There are no
receivables: what is still to be received is revenue no receipt has settled
yet (ADR 7).

## Schema changes

Edit the owning module's `src/db/schema.ts` or `src/db/triggers.sql`, then
`bun run db:regenerate`, and commit `packages/host/drizzle/`. That rebuilds the
single `0000_init.sql` from every module in list order;
`packages/host/src/initialize.test.ts` fails if a table, check, function or
trigger stops reaching it.

`db-init` records the init by filename only, so a database that already ran
the old one silently skips the new one. Deploying a changed schema means
recreating the database and re-running `bootstrap`; see `docs/operating/runbook.md`.
Recreating production needs the owner's explicit authorization each time.

## Style

Names follow one rule per layer (module, operation, tool, route, table,
web view); [CONTRIBUTING.md](CONTRIBUTING.md#names) has the table. Biome
formats and lints. Tests use `bun:test`. Comments explain *why*, not what
the code already says. Documentation is in English; code identifiers, wire
enums and vendor file headers keep their real values. Name a category by what
it classifies: `financial_categories` and `product_categories`, never a bare
"category" identifier.
