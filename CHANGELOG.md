# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-09-17

First release.

Lastro is a self-hosted, MCP-first financial platform. It keeps economic facts
and cash movements as separate records — an expense is not a payment, a revenue
is not a receipt — and derives status from the settlements that link them, so a
general "transactions" table appears nowhere in the schema.

This release contains:

- **The full product over MCP**, in 55 tools. Catalog CRUD (institutions,
  accounts, card billing windows, parties, statement descriptors, categories),
  the expense and revenue cycles, transfers, position and cash flow. Every write
  takes an idempotency key, every destructive tool requires an explicit
  confirmation, and every mutation appends an audit event naming the agent
  principal and the operator it acts for.
- **An HTTP/JSON API** over the same application handlers, with Better Auth for
  human sessions. An integration suite asserts the two surfaces cannot drift.
- **Bank statement import.** A plugin per format — C6 card and account, Nubank
  account — that only parses, never infers. Rows stage as reviewable movements
  keyed so a re-import is a no-op; promotion into an expense, a revenue or a
  transfer is separate, separately authorized, and refuses rather than guesses
  when a descriptor is not yet mapped.
- **A web interface** built around that path: a summary home, the descriptor
  review bench, a promotion screen, the three cycle views, the chart of accounts
  and catalog CRUD. Tailwind CSS v4 and shadcn/ui, light and dark, keyboard
  operable, WCAG 2.2 AA.
- **Tenancy enforced by PostgreSQL.** Composite keys carry `book_id`, and
  database triggers hold the settlement invariants that application code alone
  cannot guarantee under concurrency — including the two caps that stop a
  settlement exceeding its expense's total or its receipt's amount.
- **Books as the isolation unit.** An agent credential is bound to one Book, so
  several agents share an install without seeing each other's ledger.
- **`bun run bootstrap`** for first-run setup and for adding each later Book.
- **Deployment on Docker or Apple Container**, with the dashboard served over a
  tailnet and the MCP publishable to sibling container stacks alone.
