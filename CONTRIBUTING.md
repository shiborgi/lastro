# Contributing to Lastro

Thanks for considering a contribution. This document covers the parts that are
specific to this codebase; the rest is ordinary GitHub flow.

## Getting set up

```bash
docker compose up -d     # PostgreSQL 16 on :5432
bun install
bun run db:init
bun run check
```

`bun run check` is the gate: typecheck, lint, unit tests and builds for every
workspace, plus the third-party notice and secret scans. It does not need
Docker. `bun run test:integration` does — it starts PostgreSQL, applies the
schema twice to prove it is replayable, boots the API and MCP servers and runs
the invariant suite against them.

## Where code belongs

The layering is the main thing to respect:

| Layer | May depend on | Never contains |
|---|---|---|
| `packages/domain` | nothing | I/O, frameworks, SQL |
| `packages/contracts` | domain | business rules, I/O |
| `packages/application` | domain | SQL, HTTP, React |
| `packages/db` | domain | HTTP, business rules |
| `apps/*` | application, contracts, auth | business rules |

`packages/contracts` depends on the domain for one thing only: the enums whose
members the wire has to agree with, such as `paymentMethods`. Repeating those as
zod literals meant two lists kept equal by hand.

Persistence is reached only through the port in `packages/application/src/ports`,
split by aggregate. Every member is required, so a repository that cannot answer
one fails to compile rather than throwing on the first call that needs it. Tests
fill the rest with `fakeRepository` from `@lastro/application/testing`.

If a rule is worth enforcing, it goes in `packages/domain` and every adapter
inherits it. A route, an MCP tool or a component that decides a financial
outcome on its own is a bug, and `packages/testing` has fitness tests that
will fail on the obvious versions of it.

## Adding a surface

The API, the MCP tools and the web app must not drift. When you add an
operation:

1. Add the repository method in `packages/db`, inside a transaction, writing an
   `AuditEvent`.
2. Add the application command in `packages/application`, asserting an
   `operations.*` entry.
3. Add the Zod schema in `packages/contracts` — this is what both surfaces
   parse against.
4. Expose it in `apps/api` **and** `apps/mcp`. An agent should never have less
   reach than the web app.

Writes take an idempotency key. Destructive operations require explicit
confirmation on the MCP side.

## Money

Amounts are `bigint` in the currency's minor unit and cross the wire as decimal
strings. There is no floating point path anywhere and there should not be one.
`packages/contracts` validates the string form; `packages/domain` owns the
arithmetic.

## Schema changes

The schema is split by aggregate under `packages/db/src/schema/`. Edit the right
module, then rebuild the single init migration:

```bash
cd packages/db && bun run db:regenerate
```

That regenerates `drizzle/0000_init.sql` from the schema and appends
`triggers.sql`. There is one migration by design: the project ships a database
it creates, not one it upgrades.

Invariants a `CHECK` cannot express — a settlement total that sums sibling rows,
the two-level category rule, billing windows that may not overlap — live in
`triggers.sql`, because a rule the application alone enforces is a rule two
concurrent callers can get around.

Migrations must stay replayable: `CREATE TABLE IF NOT EXISTS`, indexes with
`IF NOT EXISTS`, constraints wrapped in a `duplicate_object` guard. drizzle-kit
emits this shape already, and `packages/db/src/initialize.test.ts` fails if a
table, check or trigger stops reaching the SQL.

## Style

Biome handles formatting and linting; `bun run lint` must be clean. Tests use
`bun:test`. Comments should explain *why*, not restate the code.

## Commits and pull requests

Conventional-commit prefixes (`feat:`, `fix:`, `docs:`, `chore:`) are used but
not enforced. A pull request should state what changed and how you verified it.
CI runs the same commands listed above.
