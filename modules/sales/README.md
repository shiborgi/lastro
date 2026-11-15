# sales

**Owns:** product categories, products, sales evidence (the consumer each
type of sales content is read by, the files taken in, their sale movements
the descriptors that name each code's product and the links from a movement
to the line it became, ADR 21), the sale lines those movements post, and the
days derived from them.

**Depends on:** `kernel`, `core`

Products and sales are commercial evidence, not financial records (ADR 21).
A day's sales recognize no revenue: the day's revenue comes from the payments
report (ADRs 7 and 19). Sales knows nothing of finance; the daily close,
which needs both, is the `close` module.

Categories here are *product categories*, never financial categories. A
product category classifies what the Book sells.

## Public interface

`host.modules.sales` (`SalesApi`), for `sales-imports` and `close`:

| Member | Use |
|---|---|
| `movements.consumerOf(scope, type)` | The importer id set for the type, or null |
| `movements.setConsumer(scope, { movementType, importerId })` | Route a type of sales content to an importer |
| `movements.listConsumers(scope)` | Every consumer set |
| `movements.intake(scope, { movementType, importer, contentSha256, sourceKey, observations })` | Take in one content: the same content answers its first intake; a line already staged counts as known; a line whose descriptor names a product posts at once |
| `days.list(scope, { from?, to? })` | The posted days in the range, in date order, with revenue, cost and the products missing a cost |

## Operations

| Resource | Operation ids | HTTP (under the Book) | MCP tools |
|---|---|---|---|
| Product category | `sales.{list,create,update,delete}ProductCategor(y/ies)` | `/product-categories` | `…_product_category`, `list_product_categories` |
| Product | `sales.…Product(s)` | `/products` | `…_product`, `list_products` |

| Sales day | `sales.getSalesDay`, `sales.listSalesDays` | `GET /sales-days/:businessDate`, `GET /sales-days` | `get_sales_day`, `list_sales_days` |
| Sale evidence | `sales.listSaleFiles`, `listSaleMovements`, `listSaleMovementDescriptors`, `listSaleMovementLinks`, `classifySaleMovementDescriptor`, `postSaleMovement`, `ignoreSaleMovement`, `undoSaleMovement` (destructive) | `/sale-files`, `/sale-movements`, `/sale-movement-descriptors`, `/sale-movement-links`, `/sale-movements/:id/{post,ignore,undo}` | `list_sale_files`, `list_sale_movements`, `list_sale_movement_descriptors`, `list_sale_movement_links`, `classify_sale_movement_descriptor`, `post_sale_movement`, `ignore_sale_movement`, `undo_sale_movement` |

### Sales evidence (ADR 21)

- A content is taken in once per importer identity and content hash
  (`sale_files`). Each line is a sale movement, keyed by the sha256 of its
  text; the same line again is known, never staged twice.
- A line's descriptor key is the point of sale's product code (its name when
  it prints none). A new key gets an empty descriptor; classifying it names
  the Book's product and posts every PENDING movement of it.
- Posting writes one sale line: the movement's day, quantity, revenue and
  currency, the descriptor's product, and the cost the product's
  `costOverride` gives (CATALOG), else the reported one (SALE), else MISSING,
  and its link: `external_key` (the movement's external id) and `sale_key`
  (`<external_key>-sale`).
- Undo deletes the link and the line and returns the movement to PENDING; ignore keeps it
  out with a reason. Nothing is written in finance.
- A day exists while it has lines.

## Tables

| Table | Holds |
|---|---|
| `product_categories` | The product tree, one level deep |
| `products` | What the Book sells: `product_category_id`, optional `cost_override` in minor units, `active` |
| `sale_consumers` | Per Book and `movement_type`, the importer id that reads it |
| `sale_files` | The intake ledger: type, importer id, version and fingerprint, content sha256, source key, counts |
| `sale_movement_descriptors` | Per Book and `descriptor_key` (the product code): the name first seen and the product |
| `sale_movements` | One line of a report: external id (the line's hash), day, code, name, category, quantity, revenue, reported cost, status |
| `sale_movement_links` | Per movement: `external_key`, `sale_key` (`<external_key>-sale`) and the sale line it became |
| `sales` | One product's line of a day, with its quantity, revenue, cost and where the cost came from |

## Invariants

Enforced by `src/db/triggers.sql`; tested in
`packages/testing/src/integration/sales-schema.integration.ts`.

- Product categories nest one level.
- A line's cost is missing exactly when its cost source says MISSING.
- A link joins a movement to a line that says what it printed (day,
  quantity, revenue, currency), under the movement's external key and
  `<external key>-sale`. A movement is POSTED exactly when it has its link,
  and every line has one (checked at commit).

## Testing

`@lastro/sales/testing` exports `memorySalesPort()` and
`salesTestHost(port, clock, extra)`: core, finance, sales and any module in
`extra` over memory inside the real envelope.
