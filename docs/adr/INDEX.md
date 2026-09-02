# Architecture Decision Records

This index records the irreversible choices for Lastro per `docs/architecture.md` and WAVE-1.1.

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
- Barback (external) owns registration; Lastro owns the contract definition.

## 6. Money
- Minor units as `bigint` internally.
- At API/MCP/JSON boundaries: validated decimal minor-unit strings only.
- Never accept raw JavaScript numbers for amounts.

## 7. Derived State
- Financial status (e.g. paid, received) is always derived from active settlements.
- Status is never set directly.

## 8. Imports
- Bank imports never silently infer economic facts (expenses/revenues).
- They produce reviewable cash movements or drafts.

## 9. Tooling & Runtime
- Bun workspaces + Turborepo.
- Hono for API/MCP/worker.
- Drizzle + PostgreSQL.
- Next.js 16 + React 19 for web.
- Better Auth for sessions + revocable service principal creds for agents.
- Biome + strict TypeScript.
- No Redis, no GraphQL, no Supabase in foundation.

## 10. Auth
- Better Auth for user sessions.
- Revocable service-principal credentials for agents/MCP callers.

## 11. UI
- Hybrid 8-bit aesthetic (chrome, controls, buttons) inspired by 8bitcn/ui.
- Financial data uses legible typography and `tabular-nums`.
- Selected MIT components from registry are copied with attribution in THIRD_PARTY_NOTICES.md.

## 12. Third-party
- Copied registry sources are attributed (project, license, revision, component).

All decisions above are closed for WAVE-1.1 and recorded to prevent re-litigation without explicit new Wave.
