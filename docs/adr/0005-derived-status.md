# ADR 5: Status Is Derived from Active Settlements

**Status:** Accepted (0.1.0)

## Context

A stored status drifts from the settlements that justify it.

## Decision

- Whether an expense or revenue is open, partially settled or settled is computed from its active settlements. A payment's and a receipt's amount is the signed sum of its active settlements, kept by a trigger and never supplied.
- A receipt is expected while it has no paid date and received once it has one.
- Settlements are voided and replaced, never edited.

## Consequences

- Nothing can mark a record paid without the settlement that pays it.
