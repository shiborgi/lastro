# Runbook

Day-to-day operation of a running install. Installation is covered in
[install.md](install.md).

## Health

| Endpoint | Meaning |
|---|---|
| `GET :3001/health` | API up and PostgreSQL reachable. 503 when the database is down |
| `GET :3002/health` | Same, for the MCP server |
| `GET :3002/health/live` | Process is alive. No auth, no database check — use this for liveness probes and `/health` for readiness |

## Logs

The MCP server emits one JSON line per tool call with the tool name, latency
and outcome, and never logs argument values:

```bash
docker compose -f docker-compose.release.yml logs -f mcp
```

## Backup and restore

```bash
bun run backup                 # pg_dump -Fc into $DUMP_PATH (/tmp/lastro.dump)
DUMP_PATH=/backups/lastro-$(date +%F).dump bun run backup
bun run restore                # pg_restore --clean --if-exists
```

Take a backup before every upgrade. Restores are destructive: they drop and
recreate the objects in the dump.

## Schema changes

`db-init` runs on each boot, applies pending migrations and records them in
`schema_migrations`. It is safe to re-run. To apply migrations by hand against
a reachable database:

```bash
DATABASE_URL=... bun run db:init
```

## Credentials

Issue an MCP credential with `bun run bootstrap --book <name> --agent
<principal>`. The owner and a Book of that name are reused across runs; the
credential is not — it is shown once and stored scrypt-hashed, so every run
mints a new one and a lost credential is replaced, never recovered.

A credential is bound to one Book, which is what keeps several agents on one
install from seeing each other's ledger. Retire the ones you stop using: they
stay valid until revoked.

## Verification before a release

```bash
bun run release:gate
```

Runs a frozen-lockfile install, the full `check` gate and the PostgreSQL-backed
integration suite. The suite applies the schema twice to prove migrations are
replayable, boots the API and MCP servers and asserts the financial invariants
against a real database.

## When something looks wrong

- **A settlement was rejected.** Settlements may only join records from the same
  Book and the same currency, and active settlements may never exceed the
  expense total. The error code says which rule fired.
- **A payment's amount looks wrong.** It is derived from the active settlements
  it groups and cannot be set directly. Void a settlement to change it.
- **An agent cannot see a record.** Agent credentials are bound to a single
  Book, and the record probably lives in another one. If the caller sends
  `x-book-id`, a mismatch with the credential's own Book fails authentication
  outright rather than returning an empty list.
- **Tracing a change.** Every mutation appends an `audit_events` row with the
  actor, the agent principal, the delegated operator and a correlation id.
