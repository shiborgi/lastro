# ADR 21: Sales Are Sale Movements, Posted by Product

**Status:** Accepted (0.1.0)

## Context

The point of sale's sales by product feed the daily close and must map to the Book's catalogue.

## Decision

- A sales report by product is staged as `sale_movements`, one per line, with its file in `sale_files`. Each point-of-sale product code has a `sale_movement_descriptor` naming the Book's product.
- Posting writes one line in `sales`, joined to its movement by `sale_movement_links`: the movement's day, quantity, revenue and currency, the descriptor's product, and the cost the catalogue, the report or nothing gives.
- A sales day is derived from its lines. Sales recognize no revenue and know nothing of finance.
- The daily close (sold, cost, the share of the month's fixed costs, result) belongs to `close`, which reads sales' days and finance's fixed expenses. It is computed on every read, never stored.

## Consequences

- Products and margins come from the point of sale; money comes from finance.
