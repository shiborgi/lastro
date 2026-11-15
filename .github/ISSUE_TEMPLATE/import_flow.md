---
name: New import flow
about: Propose a parser for a bank, card, point of sale or acquirer export
labels: import-flow
---

**Source** — the system and the export (menu path, file name, format).

**Columns** — every column, its meaning and a redacted sample row.

**What it becomes** — which movements it fills (`account-movements`,
`card-movements`, `revenue-movements`, `receipt-movements`,
`sale-movements`) and what its descriptors decide.

See `docs/extending/adding-an-import-flow.md` and `docs/flows/TEMPLATE.md`.
