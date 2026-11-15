# Installing Lastro

Two supported paths. Docker Compose works anywhere Docker does and is what CI
exercises; Apple Container is a macOS-native alternative if you prefer it.

## Prerequisites

- [Bun](https://bun.sh) 1.4 or newer
- Docker with Compose v2 (or Apple Container on macOS 26+, Apple Silicon)
- Ports 3000, 3001 and 3002 free, or set `LASTRO_WEB_PORT`, `LASTRO_API_PORT`
  and `LASTRO_MCP_PORT` (Docker Compose) to others

## Configure

```bash
cp .env.example .env
```

Set at least:

| Variable | Why |
|---|---|
| `BETTER_AUTH_SECRET` | Signs session cookies. 32+ random characters: `openssl rand -base64 32` |
| `LASTRO_DB_PASSWORD` | PostgreSQL password. Change it before exposing anything beyond localhost |

The rest have working defaults for a local install.

## Docker Compose

```bash
docker compose -f docker-compose.release.yml up -d --build
```

That brings up PostgreSQL with a named volume, runs a one-shot `db-init`
container that applies the schema, then starts the API, the MCP server and the
web app once the schema is in place.

Create the owner, its first Book and an agent credential. Bootstrap runs
inside the API container, which already has the database URL and the auth
secret:

```bash
docker compose -f docker-compose.release.yml exec api bun scripts/bootstrap.ts \
  --email you@example.com --password 'a-long-passphrase' --book "My business" --agent agent:example
```

It prints an MCP credential **once**. Store it before moving on.

### One credential per agent

A credential is bound to one Book and acts as one member of it, with that
member's role resolved on every request: a call naming another Book is
refused, not answered with an empty list. Give each agent its own principal,
since that is what the audit trail records, and a delegate with the narrowest
role it needs:

```bash
docker compose -f docker-compose.release.yml exec api bun scripts/bootstrap.ts \
  --email you@example.com --book "My business" \
  --delegate agent@lastro.local --role EDITOR --agent agent:example
```

The owner and each Book (matched by its key, a slug of the name unless
`--key` is given) are reused on re-runs. A credential is not: its secret is
stored only as a hash, so every run mints a fresh one and prints it once.
Revoke the ones you stop using with the `revoke_agent_credential` tool.

Verify:

```bash
curl -fsS http://localhost:3001/health   # {"status":"ok",...}
curl -fsS http://localhost:3002/health   # {"status":"ok",...}
open http://localhost:3000
```

## Apple Container (macOS)

```bash
brew install container
BETTER_AUTH_SECRET=$(openssl rand -base64 32) bun run apple-container install
```

The script builds the image, creates its own container network and volume,
starts PostgreSQL, applies the schema, starts the services and waits for
health. Apple Container does not resolve container names across containers and
reassigns IPs on restart, so the script syncs `/etc/hosts` in every container
on each boot.

Published ports bind to `127.0.0.1` only. Nothing is reachable from your LAN;
remote access is Tailscale's job (below). Set `LASTRO_BIND=0.0.0.0` to opt out.

### Reaching the dashboard over Tailscale

```bash
BETTER_AUTH_SECRET=$(openssl rand -base64 32) \
  bun run apple-container install --tailscale
```

This resolves the machine's MagicDNS name, starts the API with that HTTPS
origin, and puts the dashboard behind `tailscale serve` on a port of its own:

```text
https://<machine>.<tailnet>.ts.net:8443  ->  127.0.0.1:3000
```

A dedicated port rather than the node's default 443, so Lastro claims one port
and leaves the rest of the tailnet node free — including for a second Lastro
stack. Override with `LASTRO_TAILSCALE_PORT`.

Real TLS, reachable from every device on your tailnet, no port open to the LAN
and no credential in the URL. The origin — hostname *and* port — has to be
known *before* the API starts: Better Auth binds its session cookie to it, so a
stack installed without `--tailscale`, or served on a different port than the
API was told about, will reject sign-in as though the password were wrong.
Re-run `install --tailscale` in that case rather than `tailscale` on its own.

Add `--with-mcp` to also publish the MCP endpoint at
`https://<machine>.<tailnet>.ts.net:8444/mcp/<module>`, so an agent on another device
can drive the ledger (`LASTRO_TAILSCALE_MCP_PORT` to change it).

`bun run apple-container untailscale` removes the serve config; `teardown` does
it automatically.

### Reaching the MCP from another container stack

A container on this host cannot reach a port bound to loopback. To let a
sibling stack — an agent runtime, say — call the MCP without exposing anything
else, publish the MCP container on the host's container-bridge address:

```bash
container network inspect default    # read `ipv4Gateway`, e.g. 192.168.64.1

LASTRO_MCP_EXTRA_PUBLISH=192.168.64.1:3013 \
BETTER_AUTH_SECRET=$(openssl rand -base64 32) \
  bun run apple-container install
```

Only the MCP container gets the second route; the dashboard, the API and
PostgreSQL stay on `LASTRO_BIND`, so a peer that reaches the MCP reaches
nothing else. Give the extra route a port of its own — Apple Container refuses
two publish specs that share a host port even when the addresses differ.

The bridge address is the host's, not a container's, so it survives restarts;
nothing needs re-pointing when the stack comes back.

### A second stack alongside an existing one

Every name and port is configurable, so a new install never has to disturb one
that is already running:

```bash
LASTRO_NETWORK=lastro-v1 LASTRO_PREFIX=lastro-v1 LASTRO_VOLUME=lastro_v1_pgdata \
LASTRO_WEB_PORT=3010 LASTRO_API_PORT=3011 LASTRO_MCP_PORT=3012 LASTRO_PG_PORT=5442 \
BETTER_AUTH_SECRET=$(openssl rand -base64 32) \
  bun run apple-container install --tailscale
```

The two stacks get separate subnets, separate volumes and separate containers.
Install refuses to run against a volume holding tables it did not create — the
migrations would fail partway through — and prints this command when it finds
one.

Day-two operations:

```bash
bun run apple-container ps
bun run apple-container logs api --follow
bun run apple-container stop
bun run apple-container start
bun run apple-container backup     # writes $DUMP_PATH, default /tmp/lastro.dump
bun run apple-container restore
bun run apple-container teardown   # add --volumes to delete data as well
```

## Layout

| Service | Port | Purpose |
|---|---|---|
| web | 3000 | Operator interface |
| api | 3001 | HTTP/JSON API, hosts Better Auth at `/api/auth/*` |
| mcp | 3002 | MCP over Streamable HTTP, one endpoint per module at `/mcp/<module>` |
| postgres | not published | Source of truth, persisted in the `lastro_pgdata` volume |

Services bind to `127.0.0.1` by default; containers set `HOST=0.0.0.0` so the
published ports work. Put a TLS terminator in front before exposing any of them
to a network.

## Upgrading

```bash
git pull
docker compose -f docker-compose.release.yml up -d --build
```

`db-init` runs on every boot and is idempotent: it applies the schema once and
records it by file name. A release that changes the schema therefore needs the
database recreated, not upgraded: see "Recreating the database" in
[runbook.md](runbook.md).

## Backups

```bash
bun run backup     # pg_dump -Fc to $DUMP_PATH
bun run restore
```

Back up before upgrading. The volume holds the only copy of your data.
