# Lastro

Lastro is a self-hosted, MCP-first financial platform for personal, family,
property, project, and business finances. Each independent financial scope is a
`Book`.

The product separates economic facts from cash movements:

```text
Expense != Payment
Revenue != Receipt
```

Many-to-many settlements connect expenses to payments and revenues to receipts.
The architecture and delivery requirements live in `docs/architecture.md`.

## Delivery

The repository uses CodePatrol's recoverable lifecycle:

```text
spec -> spec-review -> plan -> plan-review -> build -> build-review -> ship
```

GitHub synchronization maps initiatives to wiki pages, waves to milestones, and
works to issues.
