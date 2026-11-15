# core

**Owns:** users and sessions, Books and membership, agent credentials,
authorization, audit events, idempotency records and the write envelope.

**Depends on:** `kernel`

Every other module depends on core. Core depends on no business module and
none of its tables references a table outside core.

## The write envelope

`src/application/envelope.ts`. The host runs every operation through it. For a
Book-scope operation it performs, in order:

1. Reads the caller's role from `book_members`. A caller who is not a member
   gets `UNAUTHORIZED_OR_NOT_FOUND` (404), whether or not the Book exists. The
   role a context claims is ignored.
2. Refuses with `FORBIDDEN` (403) when the role does not reach the operation's
   access level: `read` every member, `write` OWNER, ADMIN and EDITOR, `admin`
   OWNER and ADMIN.
3. For a read, runs the handler on the connection. A read cannot audit.
4. For a write, opens one transaction and, when the context carries an
   idempotency key, takes an advisory lock on it and looks it up. A stored key
   of the same operation answers with the stored wire result and runs nothing;
   a stored key of another operation is `CONFLICT` (409).
5. Runs the handler with a `Scope` whose `handle` is the transaction.
6. Inserts the audit events the handler recorded, stamped with the actor,
   source, correlation id and operation id. A write that recorded none is a
   defect and rolls back.
7. Stores the wire result under the idempotency key and commits.

A module never opens a transaction, writes `audit_events` or touches
`idempotency_records`. It reaches the database through `dbOf(scope)` from
`@lastro/core/db`, in its own `db/` folder only.

## Public interface

`host.modules.core` (`CoreApi`, `src/application/module.ts`):

| Member | Use |
|---|---|
| `envelope` | Given to `composeModules`; nothing else calls it |
| `identity.contextForUser` | A session's user id and a Book id → `ExecutionContext`, or null |
| `identity.authenticateAgent` | `credentialId` and `secret` → the operator's context, or null for every failure alike |
| `identity.userContext` | A caller outside any Book, for user-scope operations |
| `audit.list(scope, query)` | The Book's audit events inside the caller's unit of work |
| `admin.*` | Installer-only: `getUserByEmail`, `createUser`, `ensureBook`, `setBookMember`, `issueAgentCredential`. Not operations: no surface publishes them |

Better Auth owns password sign-in and the `auth_users`, `auth_sessions`,
`auth_accounts` and `auth_verifications` rows. The HTTP adapter turns a session into a user id and calls
`identity.contextForUser`; core never sees a password.

## Operations

| Operation | Access | HTTP | MCP tool |
|---|---|---|---|
| `core.listBooks` | read, user scope | `GET /books` | `list_books` |
| `core.listAuditEvents` | read | `GET /audit-events` | `list_audit_events` |
| `core.revokeAgentCredential` | admin, destructive | `DELETE /agent-credentials/:credentialId` | `revoke_agent_credential` |

Issuing a credential is not an operation: its result is a secret, and an
operation's result is stored for idempotent replay.

## Tables

| Table | Holds |
|---|---|
| `auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications` | Better Auth's contract, under its model names `user`, `session`, `account`, `verification` (mapped in `apps/api/src/auth.ts`). An `auth_accounts` row is a sign-in method, not a financial account |
| `books` | The tenancy root: `id`, unique `key`, `name` |
| `book_members` | `(book_id, user_id)` → role |
| `agent_credentials` | A principal acting for one member of one Book; `secret_hash`, `revoked_at` |
| `audit_events` | Append-only; written only by the envelope and `admin.issueAgentCredential` |
| `idempotency_records` | `(book_id, key)` → operation and its stored wire result |

## Invariants

- An agent's role is its delegated operator's membership, resolved on every
  request. `agent_credentials` references `book_members`, so the operator must
  be a member when the credential is issued.
- The secret of a credential is returned once and stored as an scrypt hash.
- `book_members.role` is one of `OWNER`, `ADMIN`, `EDITOR`, `VIEWER` (check).
- `audit_events.actor_type` and `source` are checked against their enums.

## Testing

`@lastro/core/testing` exports `memoryCore(members)`: the real envelope over
an in-memory store. Other modules use it to unit-test their operations through
`composeModules` without PostgreSQL. See `src/application/module.test.ts`.
