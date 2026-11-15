# ADR 6: Deductions and Discounts Are Signed Items

**Status:** Accepted (0.1.0)

## Context

A fee on a sale and a discount on a bill change what moves, and must be visible as such.

## Decision

- An item is negative exactly when its financial category, or that category's group, has the `DEDUCTION` role. A trigger holds the sign against the category, including when a category changes.
- A settlement carries its item's sign. A discount obtained is a negative expense settled into the same payment; a discount given or an acquirer's fee is a negative revenue settled into the same receipt.
- Payments and receipts are never negative: writers settle the positive share first and void a deduction first.

## Consequences

- What was paid or received is always the gross less what reduced it, line by line.
