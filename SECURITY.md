# Security Policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub Security Advisories](https://github.com/shiborgi/lastro/security/advisories/new)
rather than opening a public issue. Include the affected version, what an
attacker can do, and steps to reproduce.

You should get an acknowledgement within a few days. Please give us a
reasonable window to ship a fix before disclosing publicly.

## Scope

Lastro is self-hosted software that holds financial records. The parts most
worth scrutiny:

- **Book tenancy.** Every command and query carries an authenticated `bookId`,
  and composite foreign keys include `book_id` so the database itself rejects
  cross-Book references. A path that reads or writes another Book's data is a
  serious vulnerability.
- **Agent credentials.** MCP credentials are `<id>.<secret>` bearer tokens; only
  the secret half is stored, scrypt-hashed and compared in constant time. They
  are bound to one Book and act with the permissions of the human operator they
  delegate for.
- **Session cookies.** Better Auth issues HttpOnly, SameSite=Lax cookies. The
  web app reaches the API through its own same-origin proxy, so no API
  credential is ever exposed to browser JavaScript.
- **Audit trail.** Every mutation appends an `AuditEvent` recording the actor,
  the agent principal, the delegated operator and a correlation id. Anything
  that mutates state without one is a bug.

## Operating safely

- `BETTER_AUTH_SECRET` must be at least 32 random characters and must not be
  reused across installs.
- Change `LASTRO_DB_PASSWORD` from its default before exposing the stack beyond
  localhost.
- `LASTRO_ALLOW_SIGNUP` is `false` by default. Leave it off unless you intend
  the API to accept public registrations; create accounts with
  `bun run bootstrap`.
- Services bind to `127.0.0.1` unless `HOST` says otherwise. Put a TLS
  terminator in front before exposing them.
- The MCP credential printed by `bun run bootstrap` is shown once. Treat it as
  a password.

## Supported versions

The latest release on `main` receives security fixes.
