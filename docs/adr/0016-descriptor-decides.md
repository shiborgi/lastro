# ADR 16: The Descriptor Decides Everything

**Status:** Accepted (0.1.0)

## Context

Guessing a counterparty or a category from a line's wording is wrong often enough to be dangerous.

## Decision

- Parsers read only the date, the amount, the id or line, and the name as printed.
- Each name, per account (or per point-of-sale code), has a descriptor. The descriptor alone says what its lines are: the party, the financial category or the own counter account, the payment method, the product, or the group of sales a deposit settles.
- A new name gets an empty descriptor and its lines wait PENDING. Classifying it posts every waiting line and every later one. Nothing is inferred.

## Consequences

- One classification covers every past and future line of that name, and a person or agent always decides it.
