# Changelog

All notable changes to Lastro are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-11-15

First public release.

### Ledger
- Books with members, roles and revocable agent credentials; every write
  audited and idempotent by key.
- Four financial records (expenses, payments, revenues, receipts) linked by
  signed settlements that never exceed their item; transfers between owned
  accounts; deductions and discounts as negative items.
- Catalogs: institutions, accounts and their card cycles, parties, a
  two-level chart of financial categories, product categories and products.

### Imports
- Finance's file ledger (`movement_files`) and consumers per account and type;
  sales' own (`sale_files`, `sale_consumers`).
- Eight documented flows: Nubank and C6 checking accounts, the Stone account,
  Stone payouts, the C6 card, the point of sale's payments by method, Stone's
  sales and the point of sale's sales by product.
- Descriptors decide what every line is; nothing is inferred from wording.
- Revenue from the sales; deposits, Pix credits, the till and voucher
  operators settle it, with an acquirer's promise and its bank line meeting
  in one receipt.

### Modules
- `core`, `finance` and `sales`, with `finance` and `sales` depending only on
  `core`; `finance-imports` and `sales-imports` hold the parsers; `close`
  reads sales and finance for the daily close. Every module but `core` can
  be left out of the host.
- A module extends one it depends on through `contributes` in its manifest:
  a parser can be its own package.
- One naming rule per layer (CONTRIBUTING.md, "Names"): each evidence family
  (payment, receipt, card, revenue, sale) has the same tables and tools.

### Interfaces
- HTTP and MCP adapters derived from one operation definition per
  capability. MCP serves each module as its own server at `/mcp/<module>`
  (or over stdio with `MCP_MODULE`).
- A web app for review: entries, imports per evidence family, catalogs, sale
  days and the daily close. The proxy forwards only the operations the
  registered web modules declare.
