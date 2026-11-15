# ADR 14: One File Ledger, Consumers and Types Named for Their Movements

**Status:** Accepted (0.1.0)

## Context

An agent sends files; the Book must decide who reads them.

## Decision

- Finance's file ledger is `movement_files`: every file taken into an account, by content hash and importer fingerprint. Sales keeps its own, `sale_files`, since its files belong to no account.
- A consumer says which importer reads a given content type: per account and type in finance (`movement_consumers`), per type in sales (`sale_consumers`). The importer's evidence must match the type.
- Each type names the movements it fills: `account-movements`, `card-movements`, `revenue-movements`, `receipt-movements`, `sale-movements`.
- The two import tools stay separate, each with its own model: `import_movements` (finance) and `import_sales` (sales).

## Consequences

- Adding a source is a parser and a consumer row; no new tool.
