# Contributing to Lastro

Thanks for considering a contribution. This document covers the parts that are
specific to this codebase; the rest is ordinary GitHub flow.

## Getting set up

```bash
docker compose up -d     # PostgreSQL 16 on :5432
bun install
DATABASE_URL=postgres://lastro:lastro@localhost:5432/lastro bun run db:init
bun run check
```

The gate has three commands:

| Command | Needs Docker | Proves |
|---|---|---|
| `bun run check` | no | Typecheck, lint, unit and fitness tests, builds, third-party notice and secret scans, for every workspace |
| `bun run test:integration` | yes | The init applies twice on an empty database, both adapters boot as deployed, and every `packages/testing/src/integration/*.integration.ts` passes against real PostgreSQL |
| `bun run smoke` | yes | Empty database, init, bootstrap, demo seed, API, MCP and web as deployed; an agent lists its Book over MCP and a person signs in through the web proxy |

The integration suite and the smoke test start their own PostgreSQL
(`docker-compose.test.yml`, compose project `lastro-test`, port 55432), each in
a database of its own, and tear it down at the end. They never touch the
database on 5432 and never follow an ambient `DATABASE_URL`. `smoke` needs a
built web app (`bun run check` builds it).

## Where code belongs

Code is organized by business module (ADR 11):

```text
packages/kernel     pure value types; defineOperation, defineModule, composeModules
packages/host       the module list, composition, the single generated init
packages/config     validated environment configuration
packages/testing    fitness tests, the integration suite, the smoke test
modules/core        users, Books, membership, agent credentials, audit, idempotency, the write envelope
modules/finance     catalogs, expenses, payments, revenues, receipts, settlements, transfers, imported evidence
modules/sales       products, sale evidence and lines, sales days
modules/finance-imports  bank, card, point-of-sale and acquirer parsers, staged by finance (ADR 13)
modules/sales-imports      sales-by-product parsers, staged by sales (ADR 13)
modules/close       the daily close, read from sales and finance
apps/api            the HTTP adapter (and Better Auth)
apps/mcp            the MCP adapter, Streamable HTTP and stdio
apps/web            the shell and each module's screens
```

Inside a module:

| Folder | Holds | May import |
|---|---|---|
| `src/domain` | Pure rules and types | `@lastro/kernel` |
| `src/contracts` | Zod schemas and operation descriptors; browser-safe | the kernel, domain *types*, dependencies' `/contracts` |
| `src/application` | Use cases and `port.ts` | domain, contracts, dependencies' package roots |
| `src/db` | `schema.ts`, `triggers.sql`, the repository | `drizzle-orm`, domain, the port, dependencies' `/db` |
| `src/index.ts` | The manifest | everything above |

Dependencies point one way:

```text
kernel ← core ← finance ← finance-imports
              ← sales   ← sales-imports
         finance, sales ← close
```

`finance` and `sales` do not know each other, and every module but `core` can
be left out of the host with whatever depends on it. A module
names each dependency in its manifest's `dependsOn` and in its `package.json`.
`packages/testing/src/fitness.test.ts` refuses an import across a module's
interface, an undeclared dependency, a foreign key against the dependency
direction and a manifest that disagrees with its package.
`apps/web/src/__tests__/modules-architecture.test.ts` does the same for the
web modules and the shell.

If a rule is worth enforcing it goes in the module that owns the record, and
in its `triggers.sql` when the database can hold it, because a rule only the
application enforces is one that two concurrent callers can get around. A
route, a tool or a component that decides a business outcome on its own is a
bug.

## Adding a capability

Follow [docs/extending/adding-a-module.md](docs/extending/adding-a-module.md); the same steps
apply to adding an operation to an existing module:

1. If it needs storage, add the table or column to the module's
   `src/db/schema.ts`, any rule a CHECK cannot express to `triggers.sql`,
   and the port member and repository method. Run `bun run db:regenerate`.
2. Declare the operation with `defineOperation` in `src/contracts`, and add
   it to the module's operation list.
3. Bind its handler in `src/application`. A write records an audit event
   with `scope.audit`; the envelope refuses one that does not.
4. Test it through `composeModules` with `@lastro/core/testing`'s
   `memoryCore`, and against PostgreSQL in `packages/testing/src/integration`
   when it touches SQL.

The HTTP route, the MCP tool, the web client and the proxy allowlist follow
from the descriptor. An agent never has less reach than the web app, because
both publish the same list.

Writes take an idempotency key: the `Idempotency-Key` header over HTTP, the
`idempotencyKey` field over MCP. A replay with the same key answers with the
first result and writes nothing. Destructive operations set
`destructive: true`, and the MCP adapter then requires
`confirmation: "confirm"`.

## Names

One rule per layer, so a name in one layer tells you the others:

| Layer | Rule | Example |
|---|---|---|
| Module | A business noun; an import module is `<receiving module>-imports` | `finance`, `finance-imports` |
| Operation id | `<module>.<verb><Resource>` | `finance.listPaymentMovements` |
| MCP tool | `<verb>_<resource>`, snake case; served at `/mcp/<module>` | `list_payment_movements` |
| HTTP | `/<resources>` in kebab case; a state change is `/:id/<verb>` | `/payment-movements/:id/post` |
| Table | Plural snake case, named for what a row is; no bare generic name | `payment_movements`, `financial_categories`, `auth_users` |
| Web view | `<module>-<resource>`, in a file named for the resource | `finance-card-movements` in `card-movements.tsx` |

An evidence family `<f>` (`payment`, `receipt`, `card`, `revenue`, `sale`)
always has `<f>_movements`, `<f>_movement_descriptors` and its links, and
the tools `list_<f>_movements`, `list_<f>_movement_descriptors`,
`classify_<f>_movement_descriptor`, `list_<f>_movement_links`,
`post_<f>_movement`, `ignore_<f>_movement`, `undo_<f>_movement`. A receiving
module's intake is named for what it receives: finance's `movement_files`,
`movement_consumers`, `import_movements`, `list_movement_importers`; sales'
`sale_files`, `sale_consumers`, `import_sales`, `list_sale_importers`.

Code identifiers, wire enums and vendor file headers keep their real
values; documentation is in English, the web app's labels in Portuguese.

## Money

Amounts are `bigint` in the currency's minor unit and cross the wire as decimal
strings. There is no floating point path anywhere and there should not be one.
The kernel's wire primitives validate the string form; the owning module does
the arithmetic. Quantities are not money: exact decimal text.

## Schema changes

Each module owns its tables in `src/db/schema.ts` and its hand-written rules in
`src/db/triggers.sql`. After a change:

```bash
bun run db:regenerate
```

That runs drizzle-kit over every module's schema and appends each module's
triggers in the order of `packages/host/src/modules.ts`, into the single
`packages/host/drizzle/0000_init.sql`. There is one init by design: the project
ships a database it creates, not one it upgrades.
`packages/host/src/initialize.test.ts` fails if a table, check, function or
trigger a module declares stops reaching it.

The init must stay replayable: `CREATE TABLE IF NOT EXISTS`, indexes with `IF
NOT EXISTS`, constraints wrapped in a `duplicate_object` guard, triggers
re-created with `DROP TRIGGER IF EXISTS`. drizzle-kit emits the table shape
already; hand-written triggers follow the existing ones.

## Style

Biome handles formatting and linting; `bun run lint` must be clean. Tests use
`bun:test`. Comments should explain *why*, not restate the code.

Documentation, data-model guides and diagram text are in English. Preserve
actual code identifiers, wire enums and vendor file headers. Update the
documentation generators as well as their output.

## Commits and pull requests

Conventional-commit prefixes (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`)
are used but not enforced. A pull request states what changed and how you
verified it. CI runs `check` and `test:integration`.
