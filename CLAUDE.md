# Working on Lastro

Conventions live in [CONTRIBUTING.md](CONTRIBUTING.md) and the closed decisions
in [docs/adr/INDEX.md](docs/adr/INDEX.md). This file is the short version.

## The gate

```bash
bun run check              # typecheck, lint, unit tests, builds, notice + secret scans
bun run test:integration   # real PostgreSQL, API + MCP, end to end (needs Docker)
```

`bun run check` does not need Docker. Both must pass before anything is called
done. Evidence before assertions — run the command, read the output.

## Layering

| Layer | May depend on | Never contains |
|---|---|---|
| `packages/domain` | nothing | I/O, frameworks, SQL |
| `packages/contracts` | domain | business rules, I/O |
| `packages/application` | domain | SQL, HTTP, React |
| `packages/db` | domain | HTTP, business rules |
| `apps/*` | application, contracts, auth | business rules |

If a rule is worth enforcing it goes in `packages/domain` and every adapter
inherits it. A route, an MCP tool or a component that decides a financial
outcome on its own is a bug, and `packages/testing` has fitness tests that fail
on the obvious versions of it.

`packages/application` reaches persistence only through the port in
`src/ports/`. Every member is required: a repository that cannot answer one does
not typecheck. Tests fill the rest with `fakeRepository` from
`@lastro/application/testing` — never widen the port to make a test compile.

## Adding a surface

1. Repository method in `packages/db`, inside a transaction, writing an `AuditEvent`.
2. Application command in `packages/application`, asserting an `operations.*` entry.
3. Zod schema in `packages/contracts` — what both surfaces parse against.
4. Expose it in `apps/api` **and** `apps/mcp`. An agent should never have less
   reach than the web app.

Writes take an idempotency key. Destructive MCP tools require explicit confirmation.

## Money

Amounts are `bigint` in the currency's minor unit and cross the wire as decimal
strings. There is no floating point path anywhere and there should not be one.

Status is derived from active settlements, never stored. An expense is not a
payment and a revenue is not a receipt — that is why no `transactions` table
exists.

## Schema changes

Edit the right module under `packages/db/src/schema/`, then:

```bash
cd packages/db && bun run db:regenerate
```

That rebuilds the single `drizzle/0000_init.sql` from the schema and appends
`triggers.sql`. Invariants a CHECK cannot express (settlement totals, category
nesting, billing-window overlap) live in `triggers.sql`, and
`src/initialize.test.ts` fails if a table, check or trigger stops reaching the
SQL.

## Style

Biome formats and lints; `bun run lint` must be clean. Tests use `bun:test`.
Comments explain *why*, not what the code already says.
