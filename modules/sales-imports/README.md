# sales-imports

**Owns:** the parsers of point-of-sale sales reports, behind the importer
registry, and the tool that takes a report in. No tables: what it reads is
staged by the receiving module, `sales` (ADRs 13 and 21).

**Depends on:** `kernel`, `core`, `sales`

A parser returns observations and decides nothing. The receiving module owns
the file's identity, its provenance (the importer identity below), staging,
review and posting, with real same-Book foreign keys. Provider names appear
only in this module's `src/parsers` and in `docs/flows`.

## Public interface

`SalesImportsApi.importers`, the registry (`createImporterRegistry` in the
kernel):

| Member | Answers |
|---|---|
| `list()` | Every registered parser |
| `get(id)` | One parser, or `ImporterNotFoundError` |
| `identity(id)` | `{ id, version, fingerprint }`: sha256 of the canonical id, version and configuration. The receiving module stores it with each file |

| Parser | Flow | Version |
|---|---|---|
| `yooga/sales` | [yooga-sales](../../docs/flows/yooga-sales.md) | 1 |

Bump a parser's `version` whenever what it reads or how it identifies a line
changes; the new fingerprint keeps files read before and after apart.

## Operations

| Operation | Access | HTTP | MCP tool |
|---|---|---|---|
| `sales-imports.importSales` | write | `POST /sale-imports` | `import_sales` |
| `sales-imports.setSaleConsumer` | write | `PUT /sale-consumers` | `set_sale_consumer` |
| `sales-imports.listSaleConsumers` | read | `GET /sale-consumers` | `list_sale_consumers` |
| `sales-imports.listSaleImporters` | read | `GET /sale-importers` | `list_sale_importers` |

`importSales` takes `type`, `key` (the caller's name for the content, such
as its Drive path) and `content`. The Book and type pick the consumer, sales'
`sale_consumers` row; none refuses with `NO_CONSUMER`. It parses first
(malformed content writes nothing), hashes the content and hands the
observations to `sales.movements.intake`, in one transaction.
`setSaleConsumer` checks the importer is registered and reads `type` (its
`evidence`).

## Adding a parser

A parser lives either here, as one of the examples, or in a package of its
own; both are read the same way. The steps are in
`docs/extending/adding-an-import-flow.md`.

- **Here:** `src/parsers/<flow-id>/` with the parser, its tests and redacted
  fixtures, appended to `src/parsers/index.ts`.
- **Its own package:** a module that depends on `sales-imports` and contributes
  the parser in its manifest:

  ```ts
  export const myImports = defineModule({
    id: "my-imports",
    dependsOn: ["core", "sales", "sales-imports"],
    operations: [],
    contributes: { "sales-imports": [myParser] },
    create: () => ({ api: {}, handlers: [] }),
  });
  ```

  plus one line in `packages/host/src/modules.ts`. `sales-imports` checks each
  contributed item at start-up (`asSaleImporter`) and refuses a malformed one. The
  package root exports `SaleImporter`, `ImportFormatError` and the CSV readers for reuse.

The evidence family the flow needs must exist in `sales` first.
