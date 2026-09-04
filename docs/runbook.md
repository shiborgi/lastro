# Lastro Operations Runbook

This runbook documents the self-hosted release, backup/restore, and release-gate
procedures for Lastro. It is the operational companion to
`docs/architecture.md` and the WAVE-1.8 delivery.

## Prerequisites

- A clean machine with Docker and Docker Compose installed.
- The `LASTRO_DB_PASSWORD` secret provided via the environment (never committed).
- The `LASTRO_MCP_BEARER_TOKEN` secret for the MCP service (never committed).
- The `LASTRO_API_TOKEN` session credential for the web dashboard's API calls
  (never committed).

## Release compose

Start PostgreSQL and all selected Lastro services without an external managed
dependency:

```bash
docker compose -f docker-compose.release.yml up -d --build
```

The one-shot `migrate` service applies the Drizzle schema after PostgreSQL is
healthy; `api`, `mcp`, and `worker` start only after migration completes, and
`web` starts once `api` is up. Health is reported by each service's `/health`
endpoint; PostgreSQL is gated by its own healthcheck. The API listens on
`3001`, MCP on `3002`, and the web dashboard on `3000`.

## Backup and restore

Backup a populated Book (the dump runs inside the `postgres` container, so no
host Postgres toolchain is required):

```bash
bun run backup
```

Restore into a clean database:

```bash
bun run restore
```

The drill verifies that record counts, settlement balances, audit history, and
idempotency results match the source.

## Release gate

Before accepting an image, run the full gate:

```bash
bun run release:gate
```

The gate runs `bun install --frozen-lockfile && bun run check` and
`bun run test:integration`, covering cross-Book attempts, concurrency, the ten
financial regressions, API and MCP contracts, Playwright flows, and accessibility
checks. It fails before an image is accepted if any scenario fails.

## Observability

Structured logs expose correlation IDs, durations, failures, idempotency
conflicts, access violations, and tool cost or usage. Credentials and sensitive
payloads are redacted.
