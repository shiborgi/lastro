# ADR 15: Every Line Has an External Key; Every Link Names Its Destination

**Status:** Accepted (0.1.0)

## Context

Re-importing overlapping files must recognize what was already taken in, and every record must be traceable to its line.

## Decision

- A movement's `external_id` is the source's own id when it has one, or the sha256 of the line's text, with `#n` for the n-th identical line.
- Every link from a movement to what it became carries `external_key` (the movement's external id) and the destination's own key: `expense_key`/`revenue_key` (`<external_key>-<n>` or `-<component>`), `payment_key`/`receipt_key`, `sale_key` (`<external_key>-sale`), or the `statement_key` `<from>-<METHOD>-<to>-YYYYMMDD-<amount>` with each end `a<account>` or `p<party>`.
- Where a line splits into items (a card instalment, a revenue component), each item also has a `statement_id`: the hash of the external id, the item and its amount.

## Consequences

- Every record can be found again from its line, and a re-post reuses what an undo left.
