# ADR 18: A Card Purchase Is One Expense and Its Instalments

**Status:** Accepted (0.1.0)

## Context

A purchase in instalments is billed on several invoices.

## Decision

- A card line is identified by the hash of the full line; the purchase by the hash with the current instalment reduced to its count. The purchase is one expense; each instalment is a payment on its invoice (`card-<account>-<YYYY-MM>`), by the card's `account_cycles`.
- A negative line with a DEDUCTION category is a discount on the purchase. Paying the invoice is a transfer from the paying account into the card, which the account statement's outflow joins by statement key.
- The descriptor gives the party, category and payment method.

## Consequences

- Each invoice shows what it owes, and a later invoice line finds its instalment instead of a new expense.
