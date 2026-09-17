# Architecture Decision Records

This index records the irreversible choices for Lastro, per `docs/architecture.md`.

## 1. Persistence
- PostgreSQL 16 is the local source of truth.
- All financial state lives in PostgreSQL; no other durable store in foundation.

## 2. Financial Records
- Exactly four explicit financial records: expenses, payments, revenues, receipts.
- Settlements are the many-to-many links (ExpenseSettlement, RevenueSettlement).
- No universal "transactions" table.

## 3. Naming
- "Settlement" for the link records.
- "Book" for the top-level tenancy scope.

## 4. Tenancy
- Book tenancy enforced at DB boundary (composite keys include book_id).
- Every command/query receives authenticated bookId.

## 5. MCP
- MCP is an adapter over application handlers (not a parallel API).
- Uses official MCP SDK v2: Streamable HTTP and stdio.
- Lastro owns its tool contract; any gateway in front of it registers against that contract.

## 6. Money
- Amount as `bigint` internally.
- At API/MCP/JSON boundaries: validated decimal amount strings only.
- Never accept raw JavaScript numbers for amounts.

## 7. Derived State
- Financial status (e.g. paid, received) is always derived from active settlements.
- Status is never set directly.

## 8. Imports
- Bank imports never silently infer economic facts (expenses/revenues).
- They produce reviewable cash movements or drafts.

## 9. Tooling & Runtime
- Bun workspaces + Turborepo.
- Hono for API and MCP.
- Drizzle + PostgreSQL.
- Next.js 16 + React 19 for web.
- Better Auth for sessions + revocable service principal creds for agents.
- Biome + strict TypeScript.
- No Redis, no GraphQL, no Supabase in foundation.

## 10. Auth
- Better Auth for user sessions.
- Revocable service-principal credentials for agents/MCP callers.

## 11. UI
- Quiet, dense review surface: hierarchy comes from layout, not from chrome.
- Financial data uses legible typography and `tabular-nums`.
- Colour is never the only status signal; every state is also named in text.
- Selected MIT components from the shadcn/ui registry are copied with attribution in THIRD_PARTY_NOTICES.md; the upstream app is not a dependency.

## 12. Third-party
- Copied registry sources are attributed (project, license, revision, component).

The decisions above are closed as of 1.0. Reopening one requires an explicit ADR update, not an incidental change.
