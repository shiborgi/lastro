# Flow: `<flow-id>`

Copy this file to `docs/flows/<flow-id>.md` (for example `nubank-account`)
and fill every section. Write "None" rather than deleting a section, so a
reader can tell a decided absence from a forgotten one. The document is
agreed before any parser or posting code is written, and every later change
to the flow updates it in the same commit
(`docs/extending/adding-an-import-flow.md`, ADR 13).

**Status:** Draft | Implemented (`<version>`)
**Import module:** `finance-imports` | `sales-imports`
**Importer id and version:** `<provider>/<kind>`, version `1`
**Receiving module:** `finance` | `sales`

## 1. Purpose

What this file lets the Book know that it does not know without it, and which
decision or record it feeds. One paragraph. Name the business question, for
example "which expenses this account paid this month and when".

## 2. Source system and how the file is obtained

- The system, and the account, card or establishment the file is about
  (by role and the Book's account name, never by a real number in full).
- Who obtains it, from which screen, menu or API, and with which filters and
  date range.
- How often, and how late the source is final (for example "a card invoice is
  final after it closes").
- How the agent sends it: `import_movements` (finance) or `import_sales`
  (sales) with the content type, and the consumer that routes that type to
  this importer (ADR 14).

## 3. File format and a redacted sample

- Format, encoding, delimiter, decimal and date conventions, header rows.
- Every column used, its meaning, and the columns deliberately ignored.
- A sample of three to five rows, redacted: names, document numbers, account
  numbers and authorization codes replaced, amounts and dates kept realistic.

```text
<redacted sample>
```

## 4. File identity and replay behaviour

- What identifies a file (the content hash, the importer identity) and what
  identifies each line inside it (the provider's id, or the columns hashed
  when there is none).
- Taking in the same file twice: what the second intake answers.
- Two files that overlap in dates: which lines are new, which are the same,
  and what happens to a line that changed between them.
- A parser version change: how files read by the old version are told apart.

## 5. Observations the parser returns

The parser's output type, field by field, with its unit (minor-unit
`bigint`, `YYYY-MM-DD`, ISO instant) and whether it may be null. A parser
returns observations only; it never looks up a party, an account or a record.

| Field | Type | Meaning |
|---|---|---|
| | | |

Errors: which malformed inputs refuse the whole file, and with which message.

## 6. Receiving module and evidence family

- The evidence family this flow stages into (for example account statement
  lines), and whether an earlier flow already created it.
- The intake ledger row and the staging rows: their tables, keys and the
  same-Book foreign keys to the records they may later point at.
- What the receiving module checks at intake (the account exists and is the
  right type, dates fall in the stated period, the file is not already in).

## 7. Review states and who resolves them

Each state a staged line can be in, what moves it on, and who: the agent on
its own, the agent with a person's confirmation, or a person in the web
app. Name the state a line ends in when it is deliberately not posted.

| State | Meaning | Leaves by | Who |
|---|---|---|---|
| | | | |

## 8. What posting creates in finance or sales

For each kind of line: the operation it posts through (for example
`finance.payExpense`, `finance.postMovement`, `sales.postSaleMovement`),
the records it creates or links, and their keys. State what is never
inferred (ADR 13): an imported line becomes a record only through review.
How a posted line is undone.

## 9. Cross-source checks

What another flow's evidence must agree with, and what a disagreement means
(for example "the card payment on the account statement equals the invoice
total"). Name the check, the two sources, the tolerance and who is told.

## 10. MCP tools an agent calls, in order

The run an agent performs, from a file in the inbox to posted records, with
the tool name, the inputs that matter, the idempotency key it uses and the
answer it expects. Mark the tools that need `confirmation: "confirm"`.

1. `<tool>`: ...

## 11. Web screen

What the owner sees and does: the list of files, the staged lines by state,
the actions on a line, and the counters the module's navigation shows.

## 12. Fixtures

The redacted files in the import module's `src/parsers/<flow-id>/fixtures`,
each with what it proves (a normal month, a refund, a duplicate line, a
malformed row), and the integration scenario that posts one of them.

## 13. Open questions

Each question, who answers it, and what is assumed until they do.
