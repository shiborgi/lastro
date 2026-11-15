# Adding an import flow

A flow is one source file (a bank statement, a card invoice, a point of
sale's report, an acquirer's export) read by one parser. The parser only
reads; the receiving module stages, classifies and posts (ADRs 13–16). A new
flow is a parser, either among the import module's examples or in a package
of its own; neither edits the receiving module.

## 1. Document the flow first

Copy [docs/flows/TEMPLATE.md](../flows/TEMPLATE.md) to
`docs/flows/<flow-id>.md` and fill every section: the source and how the
file is obtained, the columns with a redacted sample, what identifies a line,
the observations, what posting creates, the agent's tool sequence and the
fixtures. Never commit a real statement: redact names, documents, account
numbers and authorization codes, and keep amounts and dates plausible.

## 2. Pick the evidence family

The type the agent sends names the movements the file fills (ADR 14):

| Type | Observation | Staged as | Import module |
|---|---|---|---|
| `account-movements` | `AccountMovementObservation` (finance) | `payment_movements` / `receipt_movements` by sign | `finance-imports` |
| `receipt-movements` | `AccountMovementObservation` with `promise: true` | `receipt_movements`, expected receipts | `finance-imports` |
| `card-movements` | `CardObservation` (finance) | `card_movements` | `finance-imports` |
| `revenue-movements` | `RevenueObservation` (finance) | `revenue_movements` | `finance-imports` |
| `sale-movements` | `SaleObservation` (sales) | `sale_movements` | `sales-imports` |

If none fits, the receiving module needs a new evidence family first: its
tables, intake, descriptors and posting, documented in that module's README
and an ADR. That is a larger change; open an issue with the flow document.

## 3. Write the parser

Inside the import module it is `modules/<import-module>/src/parsers/<flow-id>/index.ts`;
in a package of its own, step 4 says where. The parser is the same:

```ts
import type { AccountMovementObservation } from "@lastro/finance";
import { type MovementImporter, readCsvTable } from "@lastro/finance-imports";

export function parseExample(content: string): readonly AccountMovementObservation[] {
  return readCsvTable(content, {
    label: "Example bank statement",
    delimiter: ";",
    columns: ["Data", "Valor", "Id", "Descrição"] as const,
    row: (cell, line): AccountMovementObservation => ({
      externalId: cell.optional("Id"),     // the source's id, or null: finance hashes `line`
      line,
      occurredOn: cell.date("Data"),
      occurredAt: null,
      amount: cell.money("Valor"),          // signed minor units, read as digits
      currency: "BRL",
      name: cell.text("Descrição"),          // as printed: the descriptor key comes from it
      description: cell.text("Descrição"),
    }),
  });
}

export const exampleAccount: MovementImporter = {
  id: "example/account",
  version: 1,
  evidence: "account-movements",
  parse: parseExample,
};
```

Rules a parser keeps:

- **Pure:** the same text always gives the same observations, or throws
  `ImportFormatError` (`ImportFormatError` in sales) naming the row. A
  malformed file writes nothing.
- **Nothing inferred:** read the date, the amount, the source's id (or leave
  it null so the line is hashed) and the name as printed. Never decide a
  party, a category, a method or a product from the wording; the descriptor
  does (ADR 16).
- **Money as digits:** never through a float.
- **Version:** bump `version` whenever what it reads or how it identifies a
  line changes. The new fingerprint keeps files read before and after apart.

## 4. Register it

**Among the examples:** append the importer to the import module's
`src/parsers/index.ts`.

**In a package of its own** (`modules/<name>-imports`, or outside this
repository): a module that depends on the import module and contributes the
parser in its manifest (ADR 11):

```ts
import { defineModule } from "@lastro/kernel";
import { exampleAccount } from "./parsers/example-account";

export const exampleImportsModule = defineModule({
  id: "example-imports",
  dependsOn: ["core", "finance", "finance-imports"],
  operations: [],
  contributes: { "finance-imports": [exampleAccount] },
  create: () => ({ api: {}, handlers: [] }),
});
```

Name the same three in its `package.json`, and append the manifest to
`packages/host/src/modules.ts`. At start-up the import module checks each
contributed item and refuses a malformed one; `list_movement_importers`
then lists it, and a consumer can route files to it. The agent's tools do
not change. `modules/finance-imports/src/application/contributions.test.ts`
is the pattern for its test.

## 5. Fixtures and tests

- `src/parsers/<flow-id>/fixtures/*.csv` (in whichever module holds the
  parser): a normal file, an overlap, and one malformed case per refusal.
- `src/parsers/<flow-id>/index.test.ts`: the parser alone.
- `src/application/<flow-id>.test.ts`: the flow over memory, through the
  real envelope. Use `financeTestHost` (or `salesTestHost`) with the import
  module and, for a contributed parser, the contributing module; see
  `stone-payouts.test.ts`, `yooga-sales.test.ts` or `contributions.test.ts`. Cover intake,
  replay, classification, posting and undo.
- `packages/testing/src/integration/`: only when the flow relies on rules the
  database holds.

## 6. Document

- Add the flow to [docs/flows/README.md](../flows/README.md), the README's
  table and the README of the module that holds the parser.
- Add its tool sequence to [docs/operating/agent.md](../operating/agent.md).
- Run the gate: `bun run check`, then `bun run test:integration` and
  `bun run smoke` when SQL or an adapter changed.

The agent then sets the consumer once (`set_movement_consumer` or
`set_sale_consumer`) and sends files with `import_movements` or
`import_sales`.
