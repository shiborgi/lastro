# Runbook

Day-to-day operation of a running install. Installation is covered in
[install.md](install.md).

Every command below that changes a running install (dropping a volume,
recreating a database, issuing or revoking a credential, writing records)
needs the owner's explicit go-ahead for that occasion. Preparing commands or
reading health does not.

## Health

| Endpoint | Meaning |
|---|---|
| `GET :3001/health` | API up and PostgreSQL reachable; 503 when the database is down |
| `GET :3002/health` | The same, for the MCP server |
| `GET :3001/health/live`, `GET :3002/health/live` | The process answers. No database check: use it for liveness, `/health` for readiness |

## Logs

The MCP server writes one JSON line per tool call to stderr, with the tool,
the agent principal, the latency and the outcome (`ok`, or `error` for a
refused call). It never logs argument values.

```bash
docker compose -f docker-compose.release.yml logs -f mcp
# Apple Container: bun run apple-container logs mcp --follow
```

Every write also leaves an audit event, readable with the `list_audit_events`
tool or `GET /v1/books/:bookId/audit-events`: who, through which operation,
on which record.

## Backup and restore

```bash
bun run backup                 # pg_dump -Fc into $DUMP_PATH (/tmp/lastro.dump)
DUMP_PATH=/backups/lastro-$(date +%F).dump bun run backup
bun run restore                # pg_restore --clean --if-exists
```

Both act on the Compose project named by `COMPOSE_PROJECT_NAME` (default: the
directory name). Apple Container has its own: `bun run apple-container backup`
and `restore`. Take a backup before every upgrade. A restore is destructive:
it drops and recreates the objects in the dump.

## Schema changes

The schema ships as one generated file, `packages/host/drizzle/0000_init.sql`,
assembled from every module's tables and triggers. `db-init` runs on each boot,
applies it once and records it in `schema_migrations` **by file name only**.

So a release that changes the schema is invisible to an existing database:
`db-init` reports nothing to apply, `/health` stays green, and the first read
of a new table or column fails. Deploying such a release means recreating the
database. Nothing is migrated.

Records cannot be carried over; they are entered again, by hand or by
sending the source files again through the import flows.

### Recreating the database

Recreating drops everything in it: the owner, the Books, their members, every
agent credential and every record.

1. **Back up**, even though it is about to be discarded:
   `bun run backup` (Docker Compose) or `bun run apple-container backup`.
2. **Drop the database.** Docker Compose:
   `docker compose -f docker-compose.release.yml down -v` (removes the
   `lastro_pgdata` volume). Apple Container:
   `bun run apple-container teardown --volumes`.
3. **Start the release.** Docker Compose:
   `docker compose -f docker-compose.release.yml up -d --build`. Apple
   Container: `BETTER_AUTH_SECRET=... bun run apple-container install` with
   the same flags and environment as before (`--tailscale`,
   `LASTRO_MCP_EXTRA_PUBLISH`, ports). `db-init` applies the new init to the
   empty database before the services start.
4. **Check the schema landed**, not just health. This must print `t`. It names
   tables only this schema has and one the previous schema had:

   ```bash
   docker compose -f docker-compose.release.yml exec -T postgres psql -U lastro -d lastro -tAc \
     "select to_regclass('financial_categories') is not null and to_regclass('sale_movements') is not null and to_regclass('revenue_movements') is not null and to_regclass('sales_days') is null and to_regclass('categories') is null and to_regclass('statement_imports') is null"
   # Apple Container: container exec lastro-postgres psql -U lastro -d lastro -tAc "..."
   ```

5. **Issue the owner, the Book and the agent credentials.** The old ones no
   longer exist. Run bootstrap inside the API container, which already has
   the database URL and the auth secret:

   ```bash
   docker compose -f docker-compose.release.yml exec api bun scripts/bootstrap.ts \
     --email you@example.com --password '...' --book "My business" \
     --delegate agent@lastro.local --role EDITOR --agent agent:example
   # Apple Container: run the same with DATABASE_URL pointing at the published
   # PostgreSQL port and the same BETTER_AUTH_SECRET: bun run bootstrap ...
   ```

   Each run prints its credential once. Put each new token where its agent
   reads it (the gateway route for that agent's MCP) before the agent next runs.
6. **Configure the Book** in this order, with the web app or the agent:
   1. Accounts the Book controls: the bank accounts, and a CASH account for
      the till. A company that owes the Book money is never an account.
   2. Financial categories: one REVENUE category for sales, REVENUE
      categories with the DEDUCTION role for discounts given and the
      acquirer's fee, an EXPENSE category with the DEDUCTION role for
      discounts obtained, and the expense categories, with FIXED on the ones
      the daily close should share by month.
   3. Parties: the people and companies on the other side of the records,
      such as customers, suppliers and the acquirer.
   4. Products and product categories.
   5. The consumers and descriptors of each import, as its flow document
      says (`docs/flows/`).
7. **Verify** with the checks under "After a recreation".

### After a recreation

- `curl -fsS :3001/health` and `:3002/health` answer `"up"`.
- The agent's `list_books` names its Book, and a read such as `list_accounts`
  answers.
- The web app signs the owner in and shows the Book.
- `list_audit_events` shows the bootstrap's `agent_credential.issued`.

## Credentials

`bootstrap` issues one credential per run for a principal acting as a member of
one Book. The owner and the Book are reused across runs; the credential is
not: it is shown once and stored scrypt-hashed, so a lost one is replaced,
never recovered.

The credential's role is its operator's membership, resolved on every request.
Give an agent a delegate with the narrowest role it needs (`--delegate`,
`--role EDITOR`); a delegate has no password and cannot sign in to the web
app. Revoke a credential you stop using with the `revoke_agent_credential`
tool (an OWNER or ADMIN of the Book; it asks for confirmation).

## Verification before a release

```bash
bun run release:gate
```

Runs a frozen-lockfile install, `check`, the PostgreSQL integration suite and
the smoke test: an empty database through init, bootstrap and the demo seed,
the three services as deployed, an agent reading its Book over MCP and a
person signing in through the web proxy.

## When something looks wrong

- **A write was refused with `CONFLICT` and a sentence.** A database rule
  refused it; the sentence is the trigger's own and names the rule (a
  settlement above its item, a category nesting too deep, a role change
  that leaves an item on the wrong side).
- **A settlement was rejected.** Settlements join records of one Book and one
  currency, carry their item's sign, and never exceed the item. The error
  code names the rule.
- **A payment or receipt amount looks wrong.** It is the sum of the active
  settlements it groups and cannot be set. Void a settlement to change it.
- **An agent cannot see a record.** Its credential is bound to one Book, and
  the record lives in another. A `bookId` naming another Book is refused, not
  answered with an empty list.
- **An agent's write is `FORBIDDEN`.** Its delegated operator's role does not
  reach the operation; check `book_members` or re-run bootstrap with the
  intended `--role`.
- **Tracing a change.** Every write has an audit event with the actor, the
  agent principal, the delegated operator, the operation and a correlation id.
