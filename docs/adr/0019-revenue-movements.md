# ADR 19: A Day's Sales by Method Are Revenue Movements

**Status:** Accepted (0.1.0)

## Context

The point of sale knows what was sold and how it was paid; the acquirer knows what it keeps.

## Decision

- A point of sale's payments report and an acquirer's sales export are staged as `revenue_movements`: one record per day and payment method (or product and brand), with gross, discount, fee (the tip), acquirer fee and the amount to be received (`gross − discount + fee − acquirer fee`).
- Each component has its own descriptor (`<method>_bruto`, `_desconto`, `_taxa`, `_taxa_adquirente`) and becomes one revenue; discounts and the acquirer fee are negative under DEDUCTION categories.
- An acquirer's gross is what the point of sale already recognized: it is not recognized again (`gross_recognized` false); only its fee is.
- A sales file by product recognizes no revenue.

## Consequences

- The day's revenues add up to the money to be received, from two sources, without counting any sale twice.
