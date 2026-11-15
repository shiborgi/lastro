# Lastro

Self-hosted, agent-first ledger for personal, family, property, project and
business finances. Each independent financial scope is a `Book`.

An AI agent operates Lastro over [MCP](https://modelcontextprotocol.io): it
sends the files your bank, card and point of sale export, and Lastro turns
them into a reviewable ledger. A compact web app is where a person reviews
and corrects. PostgreSQL is the source of truth.

## The model in one picture

```text
file ──▶ movements ──▶ descriptor ──▶ financial records
         (evidence)     (decides)      expense ≠ payment
                                       revenue ≠ receipt
```

- **Four records.** What is owed (an expense) is not what moved (a payment),
  and what was earned (a revenue) is not what arrived (a receipt).
  Settlements link them; status is derived from settlements, never stored.
- **Evidence first.** Every imported line is staged as a movement. Nothing is
  inferred from its wording: a descriptor per name (or product code) says
  what its lines are, and once it is classified every past and future line
  of that name posts on its own.
- **Revenue from sales, cash from evidence.** A point of sale's payments
  report and an acquirer's sales are the revenue; deposits, Pix credits and
  the till are the receipts that settle it, so a sale is counted once.

## Quick start

Requires [Bun](https://bun.sh) 1.4+ and Docker.

```bash
cp .env.example .env
# set BETTER_AUTH_SECRET — openssl rand -base64 32

docker compose -f docker-compose.release.yml up -d --build
bun install
bun run bootstrap --email you@example.com --password 'a-long-passphrase' \
  --book "My business" --delegate agent@lastro.local --role EDITOR \
  --agent agent:example
```

That prints an MCP credential once. Then:

- Web app — <http://localhost:3000>
- API — <http://localhost:3001>
- MCP (Streamable HTTP) — <http://localhost:3002/mcp/core>, one endpoint per module

macOS on Apple Silicon can use Apple Container instead of Docker; see
[docs/operating/install.md](docs/operating/install.md).

## Connecting an agent

Each module is its own MCP server at `/mcp/<module>`; connect to the ones the
agent uses, with one credential:

```json
{
  "mcpServers": {
    "lastro-finance": {
      "url": "http://127.0.0.1:3002/mcp/finance",
      "headers": { "Authorization": "Bearer <credentialId>.<secret>" }
    },
    "lastro-finance-imports": {
      "url": "http://127.0.0.1:3002/mcp/finance-imports",
      "headers": { "Authorization": "Bearer <credentialId>.<secret>" }
    }
  }
}
```

The others are `/mcp/core`, `/mcp/sales`, `/mcp/sales-imports` and
`/mcp/close`; `GET /mcp` lists them. A credential acts as one member of one
Book, with that member's role. Every operation of a module is a tool on its
server. Writes take an `idempotencyKey`,
destructive tools require `confirmation: "confirm"`, and every write is
audited with the agent and the operator it acts for.
[docs/operating/agent.md](docs/operating/agent.md) is the agent's guide: for
each import flow, the tool sequence and what to do when a line waits.

## Import flows

| Flow | Source file | Type | Becomes |
|---|---|---|---|
| [nubank-account](docs/flows/nubank-account.md) | Nubank checking account CSV | `account-movements` | expenses and payments, revenues and receipts, transfers |
| [c6-account](docs/flows/c6-account.md) | C6 checking account CSV | `account-movements` | the same |
| [stone-account](docs/flows/stone-account.md) | Stone account statement | `account-movements` | Pix sent; the day's Pix sales as one receipt |
| [stone-payouts](docs/flows/stone-payouts.md) | Stone payout report | `receipt-movements` | expected receipts, paid by the bank line |
| [c6-card](docs/flows/c6-card.md) | C6 card invoice | `card-movements` | purchases with their instalments |
| [yooga-payments](docs/flows/yooga-payments.md) | Point of sale payments by method | `revenue-movements` | the day's revenue: gross, discount, tip |
| [stone-sales](docs/flows/stone-sales.md) | Stone sales export | `revenue-movements` | the acquirer's fee |
| [yooga-sales](docs/flows/yooga-sales.md) | Point of sale sales by product | `sale-movements` | the day's sale lines |

The providers are examples: each flow is one parser over a documented
format. [Adding an import flow](docs/extending/adding-an-import-flow.md) is a
parser, its fixtures and a flow document.

## Architecture

```text
packages/kernel   value types, defineOperation, defineModule, the importer registry
packages/host     the module list, composition, the single generated init
packages/config   validated environment configuration
packages/testing  fitness tests, the integration suite, the smoke test

modules/core              identity, Books, membership, agent credentials, audit, idempotency
modules/finance           catalogs, the four records, transfers, imported evidence
modules/sales             products, sale evidence and lines, sales days
modules/finance-imports parsers of bank, card, point-of-sale and acquirer files
modules/sales-imports     parsers of point-of-sale sales by product
modules/close             the daily close, read from sales and finance

apps/api          HTTP adapter, hosts Better Auth
apps/mcp          MCP adapter, stdio and Streamable HTTP
apps/web          Next.js shell and each module's screens
```

Each business module owns its rules, contracts, use cases, persistence port,
tables, triggers, operations and screens. `finance` and `sales` depend only on
`core`; the import modules and `close` build on them, and every module but
`core` can be left out. A parser can be its own package, contributed to an
import module through its manifest. An operation is declared once; the
HTTP routes, MCP tools, web client and proxy allowlist derive from it.
`core`'s write envelope runs every write: authorization from Book
membership, one transaction, idempotent replay and the audit event. Adding a
module edits no other: [docs/extending/adding-a-module.md](docs/extending/adding-a-module.md).

More: [architecture](docs/architecture.md) ·
[data model](docs/data-model.md) ·
[domain dictionary](docs/domain-dictionary.md) ·
[data dictionary](docs/data-dictionary.md) ·
[diagrams](docs/diagrams/lastro-data-model.html) ·
[decisions](docs/adr/README.md) ·
[roadmap](ROADMAP.md).

## Invariants

- Money is a `bigint` in the currency's minor unit; JSON carries decimal
  strings. No floats, anywhere.
- Every operation is scoped to an authenticated Book, and every reference
  carries the Book in its key.
- Settlements carry their item's sign and never exceed it; payments and
  receipts are the signed sum of their settlements and never negative. These
  are database triggers.
- Status is derived from active settlements; settlements are voided, never
  edited.
- Every write is idempotent by key and appends an audit event.

## Development

```bash
docker compose up -d          # PostgreSQL 16 on :5432
bun install
DATABASE_URL=postgres://lastro:lastro@localhost:5432/lastro bun run db:init
bun run check                 # typecheck, lint, unit and fitness tests, builds, scans
bun run test:integration      # Docker: real PostgreSQL, both adapters
bun run smoke                 # Docker: the install path end to end
```

Changing the schema: edit the owning module's `src/db/schema.ts` or
`src/db/triggers.sql`, then `bun run db:regenerate`. There is one init by
design; Lastro ships a database it creates, not one it upgrades.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the
[code of conduct](CODE_OF_CONDUCT.md). Security reports:
[SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE). UI primitives are copied from
[shadcn/ui](https://ui.shadcn.com), also MIT; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
