# ADR 9: Runtime and Tooling

**Status:** Accepted (0.1.0)

## Context

A small, self-hosted stack an agent can operate.

## Decision

- Bun workspaces and Turborepo; strict TypeScript; Biome for format and lint; `bun:test`.
- Hono for the HTTP API; the official MCP SDK over Streamable HTTP and stdio; Next.js and React for the web app; Drizzle over PostgreSQL.
- Better Auth for people's sessions; revocable, hashed credentials for agents, each acting for one member of one Book with that member's role.

## Consequences

- No Redis, GraphQL or hosted backend. An install is a database and three services.
