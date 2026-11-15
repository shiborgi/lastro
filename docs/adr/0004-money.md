# ADR 4: Money Is a Bigint in Minor Units

**Status:** Accepted (0.1.0)

## Context

Floating point loses cents.

## Decision

- Amounts are `bigint` in the currency's minor unit, with an explicit three-letter currency.
- At every JSON boundary (HTTP, MCP, web) amounts are validated decimal strings. A JavaScript number is never accepted for money.
- Quantities are not money: exact decimal text.

## Consequences

- There is no floating point path anywhere; parsers read amounts as digits.
