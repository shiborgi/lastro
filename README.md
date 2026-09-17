# Lastro

Self-hosted, MCP-first financial platform for personal, family, property,
project and business finances. Each independent financial scope is a `Book`.

Lastro is built to be operated by an AI agent over
[MCP](https://modelcontextprotocol.io) as its primary interface, with a compact
web app for review and direct edits. PostgreSQL is the source of truth.

## The one idea worth knowing

Lastro separates economic facts from cash movements:

```text
Expense  ≠  Payment
Revenue  ≠  Receipt
```

An expense is split into settlements — its installments. A payment groups one
or more settlements, may cover installments from several different expenses,
and has its own due date. A payment's amount is *derived* from the active
settlements it groups; it is never entered directly. The same holds for
revenues and receipts.

That distinction is why a general "transactions" table appears nowhere in the
schema.

## Quick start

Requires [Bun](https://bun.sh) 1.4+ and Docker.

```bash
cp .env.example .env
# set BETTER_AUTH_SECRET — openssl rand -base64 32

docker compose -f docker-compose.release.yml up -d --build
bun install
bun run bootstrap --email you@example.com --password 'a-long-passphrase'
```

That prints an MCP credential once. Then:

- Web app — <http://localhost:3000>
- API — <http://localhost:3001>
- MCP (Streamable HTTP) — <http://localhost:3002/mcp>

macOS on Apple Silicon can use Apple Container instead of Docker; see
[docs/install.md](docs/install.md).

## Connecting an agent

Lastro speaks MCP over Streamable HTTP and stdio. With the credential printed
by `bun run bootstrap`:

```json
{
  "mcpServers": {
    "lastro": {
      "url": "http://127.0.0.1:3002/mcp",
      "headers": { "Authorization": "Bearer <credentialId>.<secret>" }
    }
  }
}
```

A credential is bound to one Book. Calls name the Book they act on, and a
credential issued for a different one is rejected rather than returning an
empty result — so an agent cannot reach another agent's ledger even by asking
for it. Give each agent its own Book and credential and they stay separated by
construction:

```bash
bun run bootstrap --email you@example.com --password '...' --book Butler    --agent agent:butler
bun run bootstrap --email you@example.com --password '...' --book Bartender --agent agent:bartender
```

Send `x-book-id` as well to assert which Book you expect: a token for a
different one is then rejected instead of writing to the wrong ledger.

The agent gets the whole product across 55 tools: catalog CRUD (institutions,
accounts, parties, categories, card billing windows, statement descriptors), the
expense and revenue cycles, transfers, positions and cash flow, and bank
statement import with its review and promotion steps. Every write takes a
mandatory idempotency key, every destructive tool requires an explicit
`confirmation: "confirm"`, and every mutation appends an audit event naming the
agent principal and the operator it acts for.

## Bank statements

Lastro reads a statement as a plugin per format — C6 card and account, Nubank
account — chosen by the storage path `<institution>/<kind>/<file>`. A plugin
only parses. It never decides that a line is an expense, never invents an
institution, and never guesses which merchant a line belongs to: it records the
wordings it has never seen, without a destination, for a person to map.

Importing the same file twice is a no-op. Every row carries
`sha256(institution, account, date, descriptor, amount)` plus an occurrence
number, so a re-import collides while two genuinely identical purchases on one
day stay two rows.

Promotion — turning a reviewed row into an expense, a revenue or a transfer — is
a separate step with its own permission, and it refuses rather than guesses when
a descriptor names no party or no category. Naming another account on a
descriptor *is* the declaration that its lines are transfers, which is why a
transfer seen on both statements collapses to one record instead of two.

## Architecture

```text
apps/web       Next.js operator interface (Tailwind CSS v4 + shadcn/ui)
apps/api       authenticated HTTP/JSON API, hosts Better Auth
apps/mcp       MCP adapter — stdio and Streamable HTTP

packages/domain        entities and invariants, no framework
packages/application   commands, queries, authorization, ports
packages/db            PostgreSQL schema, migrations, port implementations
packages/contracts     Zod schemas shared by API, MCP and the web app
packages/auth          agent credentials, RBAC, Book membership
packages/config        validated environment configuration
packages/testing       PostgreSQL-backed integration suite
```

API, MCP and the web app call the same application handlers. Domain rules never
live in routes, tools or components. Only `packages/db` knows SQL.

Persistence is reached through a port split by aggregate
(`packages/application/src/ports`) whose every member is required, so a
repository that cannot answer one fails to compile rather than throwing on the
first call that needs it.

Details in [docs/architecture.md](docs/architecture.md).

## Invariants

- Money is a `bigint` amount plus an explicit currency; JSON carries amounts as
  validated decimal strings. No floats, anywhere.
- Every command and query is scoped to an authenticated `bookId`.
- A settlement may only connect records from the same Book and currency.
- Active settlements may never exceed their expense's total, nor their
  receipt's. Both caps are database triggers, because a rule the application
  alone enforces is a rule two concurrent callers can get around.
- Status is derived from active settlements, never set directly.
- Confirmed settlements are voided and replaced, never edited in place.
- Every mutation is idempotent and appends an `AuditEvent`.

## Development

```bash
docker compose up -d          # PostgreSQL 16 on :5432
bun install
bun run db:init               # apply the schema
bun run check                 # typecheck, lint, unit tests, builds
bun run test:integration      # real PostgreSQL, api + mcp, end to end
```

Changing the schema: edit the right module under `packages/db/src/schema/`, then
run `cd packages/db && bun run db:regenerate`. That rebuilds the single
`drizzle/0000_init.sql` and appends `triggers.sql`. There is one migration by
design — Lastro ships a database it creates, not one it upgrades.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports go to
[SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE). UI primitives are copied from
[shadcn/ui](https://ui.shadcn.com), also MIT; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
