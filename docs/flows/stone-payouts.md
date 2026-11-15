# Flow: `stone-payouts`

Stone's deposits into the business's C6 account: one row per deposit of one mode
and brand. Each deposit is Stone's promise, a receipt movement of the C6
account posted as an expected receipt; the C6 statement's line for the same
money is the promise kept, and pays that same receipt.

**Status:** Implemented (0.1.0). What comes from Stone is the promise of a
deposit and what comes from C6 its confirmation; both movements point to the
same receipt, which settles the day's sales and creates no revenue (ADR 20).
**Import module:** `finance-imports`
**Importer id and version:** `stone/payouts`, version `1`
**Receiving module:** `finance`

Decisions: ADRs 15, 16, 17, 19 and 20.

## 1. Purpose

Record each deposit Stone promises into C6 as an expected receipt, and have
the C6 statement's line for the same deposit pay it, so one receipt stands
for it whichever is imported first: expected while only Stone said so,
received once C6 shows it.

## 2. Source system and how the file is obtained

- Stone's portal exports the payouts of a period.
- The agent calls `import_movements` with:
  - the **C6** account's `accountId` (where the money lands);
  - `type: "receipt-movements"`;
  - the file's path as `key`;
  - the text as `content`.
- Set once: `set_movement_consumer` (C6 account, `receipt-movements`,
  `stone/payouts`), beside the C6 account's `account-movements` consumer.

## 3. File format and a redacted sample

- `;`-delimited, one header row, amounts `2283,01` or `1.589,31`.

| Column (read) | Meaning |
|---|---|
| `Identificador Rastreável do Pagamento` | Stone's id for the deposit |
| `Valor` | What was deposited: the net of the sales |
| `Modalidade`, `Bandeira` | Débito/Crédito and the brand as printed (Maestro, VisaElectron, EloDebito, Visa, Mastercard, Elo, AmericanExpress) |
| `Data de Vencimento` | The day it is due: the promise's day |
| `Status do Pagamento` | `Pago` or `PaymentScheduled`, as printed; both are promises, and not read |

The bank columns (the destination bank, branch and account), the business's document,
StoneCode and name repeat on every row and are not read.

```text
Valor;Bandeira;Modalidade;…;Identificador Rastreável do Pagamento;Resposta do Banco;Origem da Conta;Data de Vencimento;Data de Pagamento;Status do Pagamento
937,03;Maestro;Débito;…;202601070000000000001;00;Cadastro;07/01/2026;07/01/2026;Pago
```

Checked against real exports: no id repeats across files, the due day is
the paid day, and every paid deposit has a C6 line of the same day and amount
(`CRED LOJ …`, `STONE INSTITUICAO DE PAGAMENTO S.A`). Pix and the voucher
operators are never in this report.

## 4. File identity and replay behaviour

- **File:** as for every statement.
- **Line:** `external_id` is Stone's id. A deposit already staged is
  `known`: a scheduled deposit exported again once paid has the same id,
  day and amount, and is not staged twice.
- **Links:** as every receipt movement: `external_key`, `revenue_key`,
  `receipt_key` and the `statement_key`
  `p<Stone>-<METHOD>-a<C6>-<day>-<amount>`.

## 5. Observations the parser returns

`AccountMovementObservation`, one per row, with `promise: true`: `externalId`
(Stone's id), `occurredOn` (the due day), `amount` (positive), `name`
(`Modalidade Bandeira`, as printed) and the row as `line` and `description`.

Refusals (`IMPORT_FORMAT`): another header, an unreadable amount or date,
a row with no id, no rows.

## 6–8. Evidence, review states, posting

The account movement family (`nubank-account`): `receipt_movements` of the
C6 account, a descriptor per mode and brand, posted when its party, financial
category and payment method are filled.

**The promise and the money (ADR 20).** A movement marked `promise` posts
its receipt due on its day with no paid date: expected. A receipt movement
posted with a party computes the statement key
`p<party>-<METHOD>-a<account>-<day>-<amount>`. When another receipt movement
of the account, from a content of another type, already posted with that
key, this one links the same revenue and receipt instead of creating new
ones; when this one is the bank line (not a promise), it also pays the
receipt on its day. A C6 line posted first is received at once, and the
promise joins it. A receipt pairs at most one sighting of each type, so two
equal deposits on one day pair one to one. The key matches when both
descriptors name the same party (Stone) and payment method.

Undoing the C6 line leaves the receipt expected while the promise still
links it; undoing the promise keeps the receipt the C6 line paid.

## 9. Cross-source checks

- **The sales.** A deposit is the net of the days' sales of one mode and
  brand (`stone-sales`); most deposits match a run of days to the cent, the
  rest are days split across deposits. A standing check is on the roadmap.

## 10. MCP tools an agent calls, in order

1. Once: `set_movement_consumer` (C6 account, `receipt-movements`,
   `stone/payouts`).
2. Per export: `import_movements`.
3. `classify_receipt_movement_descriptor` for each mode and brand, and for the C6
   statement's Stone lines, with the same party (Stone), payment method and
   `settlementGroup`, and no financial category, so both compute one
   statement key and settle the group's sales (ADR 20). Ask the Book's owner which.
4. `list_receipt_movement_links` by `statementKey` shows both sightings and their
   one receipt.

## 11. Web screen

Financeiro → Importações → **Extratos**, the C6 account: the deposits beside
the statement's lines. Financeiro → Lançamentos → **Recebimentos** shows each
receipt as *Esperado* until its bank line arrives, then *Recebido*.

## 12. Fixtures

`modules/finance-imports/src/parsers/stone-payouts/fixtures/month.csv`:
two deposits matching `c6-account/fixtures/month.csv`, one without a C6
line, and a scheduled one.

Covered by:
- `stone-payouts/index.test.ts`;
- `finance-imports/src/application/stone-payouts.test.ts`;
- `packages/testing/src/integration/finance-payouts.integration.ts`.

## 13. Open questions

1. **A partial export.** A payout export that stops before the period's end
   leaves the missing deposits as C6 lines with no promise; they still
   post, received at once.
