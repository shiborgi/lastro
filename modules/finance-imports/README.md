# finance-imports

**Owns:** the parsers of bank account, card and acquirer statements, behind the importer registry. No tables: the bank and card statement lines it reads are staged by
the receiving module, `finance` (ADR 13).

**Depends on:** `kernel`, `core`, `finance`

A parser returns observations and decides nothing; each observation names its
counterparty (`name`), whose normalization is the descriptor key. The receiving module owns
the file's identity, its provenance (the importer identity below), staging,
review and posting, with real same-Book foreign keys. Provider names appear
only in this module's `src/parsers` and in `docs/flows`.

## Public interface

`FinanceImportsApi.importers`, the registry (`createImporterRegistry` in the
kernel):

| Member | Answers |
|---|---|
| `list()` | Every registered parser |
| `get(id)` | One parser, or `ImporterNotFoundError` |
| `identity(id)` | `{ id, version, fingerprint }`: sha256 of the canonical id, version and configuration. The receiving module stores it with each file |

Bump a parser's `version` whenever what it reads or how it identifies a line
changes; the new fingerprint keeps files read before and after apart.

## Operations

| Operation | HTTP (under the Book) | MCP tool |
|---|---|---|
| `finance-imports.importMovements` | `POST /movement-imports` | `import_movements` |
| `finance-imports.setMovementConsumer` | `PUT /movement-consumers` | `set_movement_consumer` |
| `finance-imports.listMovementConsumers` | `GET /movement-consumers` | `list_movement_consumers` |
| `finance-imports.listMovementImporters` | `GET /movement-importers` | `list_movement_importers` |

`importMovements` takes `accountId`, `type` (such as `account-movements`),
`key` (the caller's name for the content, provenance only) and `content`; the
Book is the credential's. Book, account and type pick the consumer, finance's
`movement_consumers` row (ADR 14); none refuses with `NO_CONSUMER`. It parses
first (malformed content writes nothing), hashes the content and hands the
observations to the finance intake of the importer's evidence family
(`account-movements` and `receipt-movements` → `finance.accountMovements.intake`, `card-movements` →
`finance.cards.intake`, `revenue-movements` → `finance.revenueMovements.intake`),
in one transaction.

`setMovementConsumer` checks the importer is registered and reads `type` (its
`evidence`) before finance stores it. A new source for an existing family is
a parser and a consumer row; no new tool.

## Parsers

| Importer | Flow | Version |
|---|---|---|
| `nubank/account` | [nubank-account](../../docs/flows/nubank-account.md) | 1 |
| `c6/card` | [c6-card](../../docs/flows/c6-card.md) | 1 |
| `c6/account` | [c6-account](../../docs/flows/c6-account.md) | 1 |
| `yooga/payments` | [yooga-payments](../../docs/flows/yooga-payments.md) | 1 |
| `stone/sales` | [stone-sales](../../docs/flows/stone-sales.md) | 1 |
| `stone/payouts` | [stone-payouts](../../docs/flows/stone-payouts.md) | 1 |
| `stone/account` | [stone-account](../../docs/flows/stone-account.md) | 2 |

`src/parsers/csv.ts` (RFC 4180) and `src/parsers/read.ts` (columns by name,
Brazilian dates, decimal amounts, `ImportFormatError`) are shared by every
parser. A new flow follows `docs/extending/adding-an-import-flow.md`.

A file with no provider id returns `externalId: null` and its `line`, the
columns that identify it. Finance hashes the line and counts identical
movements of one day (`#2` onward).

## Adding a parser

A parser lives either here, as one of the examples, or in a package of its
own; both are read the same way. The steps are in
`docs/extending/adding-an-import-flow.md`.

- **Here:** `src/parsers/<flow-id>/` with the parser, its tests and redacted
  fixtures, appended to `src/parsers/index.ts`.
- **Its own package:** a module that depends on `finance-imports` and contributes
  the parser in its manifest:

  ```ts
  export const myImports = defineModule({
    id: "my-imports",
    dependsOn: ["core", "finance", "finance-imports"],
    operations: [],
    contributes: { "finance-imports": [myParser] },
    create: () => ({ api: {}, handlers: [] }),
  });
  ```

  plus one line in `packages/host/src/modules.ts`. `finance-imports` checks each
  contributed item at start-up (`asMovementImporter`) and refuses a malformed one. The
  package root exports `MovementImporter`, `ImportFormatError` and the CSV readers for reuse.

The evidence family the flow needs must exist in `finance` first.
