# ADR 7: Expenses and Revenues State Their Amount

**Status:** Accepted (0.1.0)

## Context

A revenue paid in parts by several receipts must keep the value it was recognized with.

## Decision

- An expense and a revenue each state their amount. Their active settlements carry their sign and never exceed it, in the database and in the use cases.
- There are no receivables: what is still to be received is revenue no receipt has settled yet.

## Consequences

- Partial settlement is safe for both cycles; status and outstanding amounts come from the settlements (ADR 5).
