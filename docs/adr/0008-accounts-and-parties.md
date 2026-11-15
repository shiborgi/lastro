# ADR 8: Accounts Are Money the Book Controls; Everyone Else Is a Party

**Status:** Accepted (0.1.0)

## Context

An intermediary that owes money modeled as an account would show money the Book cannot spend.

## Decision

- `accounts.type` is `ACCOUNT`, `CARD`, `INVESTMENT` or `CASH`, and an account is only a place the Book can receive or withdraw money.
- A company or person on the other side of a record (a customer, a supplier, an acquirer, a voucher operator) is a party, never an account.
- A card's billing windows are `account_cycles`: one per invoice, with the dates it covers and the day it is due; windows of one card never overlap.

## Consequences

- Balances are real; what an intermediary still owes is revenue not yet received.
