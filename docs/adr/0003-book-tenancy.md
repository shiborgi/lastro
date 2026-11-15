# ADR 3: The Book Is the Tenancy Boundary

**Status:** Accepted (0.1.0)

## Context

One installation serves several independent financial scopes.

## Decision

- Each independent scope is a `Book`. Every business table carries `book_id` in its primary key, and every reference includes it, so no row can point into another Book.
- Every operation runs in one authenticated Book. A credential for another Book is refused rather than answered with an empty list.
- Records that people type carry a stable `key` beside the numeric id.

## Consequences

- Isolation is a property of the schema, not of each query.
