# ADR 2: Four Financial Records and Their Settlements

**Status:** Accepted (0.1.0)

## Context

A general "transactions" table hides the difference between what is owed and what moved.

## Decision

- There are exactly four financial records: expenses, payments, revenues and receipts.
- An expense is not a payment and a revenue is not a receipt. Settlements are the many-to-many links between them: `expense_settlements` and `revenue_settlements`.
- A transfer between two accounts of the Book is its own record and is neither an expense nor a revenue.

## Consequences

- One payment can settle several expenses and one expense can be paid in parts, the same for revenues and receipts. There is no transactions table anywhere.
