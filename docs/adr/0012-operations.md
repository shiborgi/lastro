# ADR 12: One Operation Definition, Derived Surfaces, One Write Envelope

**Status:** Accepted (0.1.0)

## Context

An HTTP route, an MCP tool and a web call for the same capability drift apart when written three times.

## Decision

- A capability is declared once with `defineOperation`: id, access, input and output schemas, HTTP route and MCP tool. The HTTP and MCP adapters, the web client and the web proxy allowlist are derived from it.
- `core` runs every operation in its write envelope: the role from Book membership, one transaction, idempotent replay by key, the audit events, commit. A module never opens a transaction or writes audit itself, and a write that records no audit event is refused.
- A refusal has one stable code and message on every surface; a database refusal keeps the trigger's words.
- MCP serves each composed module as its own server (`/mcp/<module>`, or one module over stdio). An agent connects to the modules it uses and sees only their tools; there is no server of every tool.

## Consequences

- An agent and a person always meet the same rules.
