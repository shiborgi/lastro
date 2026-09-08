# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-09-07

First release.

Lastro is a self-hosted, MCP-first financial platform. It keeps economic facts
and cash movements as separate records — an expense is not a payment, a revenue
is not a receipt — and derives status from the settlements that link them, so a
general "transactions" table appears nowhere in the schema.

This release contains:

- **The full product over MCP.** Catalog CRUD (institutions, accounts, parties,
  party aliases, categories), the expense and revenue cycles, transfers,
  position and cash flow, and audit reads. Every write takes an idempotency
  key, every destructive tool requires an explicit confirmation, and every
  mutation appends an audit event naming the agent principal and the operator
  it acts for.
- **An HTTP/JSON API** over the same application handlers, with Better Auth for
  human sessions.
- **A web interface** for review and direct edits: a summary home and one tab
  per entity, built on Tailwind CSS v4 and shadcn/ui.
- **Tenancy enforced by PostgreSQL.** Composite keys carry `book_id`, and
  database triggers hold the settlement invariants that application code alone
  cannot guarantee under concurrency.
- **Books as the isolation unit.** An agent credential is bound to one Book, so
  several agents share an install without seeing each other's ledger.
- **`bun run bootstrap`** for first-run setup and for adding each later Book.
- **Deployment on Docker or Apple Container**, with the dashboard served over a
  tailnet and the MCP publishable to sibling container stacks alone.
