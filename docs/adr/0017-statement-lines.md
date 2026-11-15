# ADR 17: Statement Lines Post When Fully Mapped; Transfers Meet by Key

**Status:** Accepted (0.1.0)

## Context

A bank statement shows both sides of an own-account transfer, once in each account.

## Decision

- Money out is a payment movement, money in a receipt movement. A line posts as soon as its descriptor gives the other end (an own account, or a party with a category) and the payment method.
- A transfer's two statement lines compute the same statement key; whichever posts second joins the transfer the first created.
- Undo removes the links, voids the settlements the post made and removes a transfer no other link names. A record the post created stays and is reused.

## Consequences

- Two statements of the same money never make two transfers.
