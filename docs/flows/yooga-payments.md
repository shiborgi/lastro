# Flow: `yooga-payments`

The point of sale's payments report. Each record is one payment method on one
operational day, and becomes up to three revenues: the gross sold, the
discount given and the service fee charged.

**Status:** Implemented (0.1.0). Each record becomes up to three revenues
(gross, discount, tip), each from its own descriptor; the record's external
id covers the total paid and each item's statement id covers its own amount;
the day and the gross come from columns the agent writes (ADRs 15, 19). The
gross descriptor also says who pays the method's records: cash in the till,
or an operator's deposits (ADR 20).
**Import module:** `finance-imports`
**Importer id and version:** `yooga/payments`, version `1`
**Receiving module:** `finance`

Decisions: ADRs 13, 15, 16, 19 and 20. The file is written by the agent from
the point of sale's payments report (read only).

## 1. Purpose

Record what the till took in each day, by payment method, as the revenue it
is. There are three revenues per method:
- the products sold (gross);
- the discount given, a negative revenue;
- the service fee.

Each component is classified once by its descriptor, and every later day
posts on its own.

## 2. Source system and how the file is obtained

- Yooga's payments report, read by the agent with `get_payments_report` for
  the operational day D ([06:00 of D, 06:00 of D+1) America/Sao_Paulo).
- the agent's daily task writes `pagamentos-D.csv`.
- The agent calls `import_movements` with:
  - the till's `accountId` (the `CASH` account);
  - `type: "revenue-movements"`;
  - the file's path as `key`;
  - the text as `content`.
- Set once: `set_movement_consumer` (till, `revenue-movements`,
  `yooga/payments`).

## 3. File format and a redacted sample

- `;`-delimited, dot decimals with two places, one header row.
- One row per payment method in the order the report returns.
- A closing `TOTAL` row repeats the sum and is skipped, whether the agent
  writes `TOTAL` in `forma_pagamento` or in `data`.

| Column | Meaning |
|---|---|
| `data` | D, `YYYY-MM-DD` |
| `forma_pagamento` | The payment method as Yooga prints it (`Pix`, `Crédito`, `Vale Refeição`) |
| `quantidade` | How many payments |
| `bruto` | The products sold: `valor − acrescimo + desconto`, computed by the agent in cents |
| `desconto` | Discount given |
| `acrescimo` | Service fee charged |
| `valor` | What was paid |

```text
data;forma_pagamento;quantidade;bruto;desconto;acrescimo;valor
2026-11-08;Débito;5;335.95;0.00;14.69;350.64
2026-11-08;Pix;3;134.95;2.00;12.60;145.55
2026-11-08;TOTAL;11;571.20;2.00;35.73;604.93
```

On a real day, the products sold (the point of sale's sales report) plus
the surcharge give the amount paid. A file without `data` or `bruto` is
refused.

## 4. File identity and replay behaviour

The report has no source id. The external key is the hash of the line, as
for every source without one (ADR 19).

- **File:** as for every statement. The same content again answers
  `alreadyImported: true`.
- **Record:** `external_id` = sha256 of `<day>;<method>;<total paid>`. It is
  the group and every link's `external_key`. A record already staged is
  `known`.
- **Item:** each revenue link's `statement_id` = sha256 of
  `<external_id>;<bruto|desconto|taxa>;<item amount>`.
- **Destination:** `revenue_key` = `<external_key>-bruto`, `-desconto` or
  `-taxa`. It is also the revenue's own key, so the revenue is found again
  after an undo.

## 5. Observations the parser returns

`RevenueObservation`, one per row except TOTAL:
- `occurredOn` (from `data`);
- `name` (`forma_pagamento`, as printed);
- `quantity`;
- `gross`, `discount`, `fee`, `amount` in minor units;
- `currency` `BRL`.

Refusals (`IMPORT_FORMAT`): another header, a missing `data` or `bruto`,
an unreadable day or amount, no records. Finance also refuses a record whose
`bruto − desconto + acrescimo` is not `valor`.

## 6. Receiving module and evidence family

| Table | Holds |
|---|---|
| `movement_files` | The intake ledger (`movement_type` `revenue-movements`) |
| `revenue_movements` | One per record: day, name, method key, quantity, gross, discount, fee, paid, status |
| `revenue_movement_descriptors` | Per till and `descriptor_key` (`<method>_bruto`, `_desconto`, `_taxa`): component, party, financial category |
| `revenue_movement_links` | One link per revenue: `external_key` (the record), `statement_id` (the item), component, `revenue_key`, revenue |

This is the revenue movement family (ADR 19, amended): the report is the
sale, not yet the receivable, so it becomes revenues and never a receipt.

## 7. Review states and who resolves them

| State | Meaning | Leaves by |
|---|---|---|
| `PENDING` | A component it carries has no filled descriptor | `classify_revenue_movement_descriptor` for each, or `ignore_revenue_movement` |
| `POSTED` | One revenue per component it carries (deferred trigger) | `undo_revenue_movement` |
| `IGNORED` | Not revenue, with a reason | `undo_revenue_movement` |

A component that is zero (no discount that day) has no descriptor and no
revenue.

## 8. What posting creates in finance

| Component | Revenue |
|---|---|
| `bruto` | The gross, under the descriptor's REVENUE category |
| `desconto` | Minus the discount, under a DEDUCTION REVENUE category |
| `taxa` | The fee, under a REVENUE category |

Each revenue has competence D's month and occurs on D. Undo removes the links;
the revenues stay, and the next post of the record reuses them by key. There
is no choosing an existing record.

## 9. Cross-source checks

- The day's sales file (`yooga-sales`) holds the products: their sum should
  equal the day's gross. It is not checked in version 1.
- Card and Pix receipts settle into these revenues later, from the acquirer
  flows. Not in version 1.

## 10. MCP tools an agent calls, in order

1. Once: `set_movement_consumer` (till, `revenue-movements`, `yooga/payments`).
2. Daily, after the file is written: `import_movements`.
3. When `pending` > 0: `list_revenue_movement_descriptors` with
   `classified: "false"`. Then `classify_revenue_movement_descriptor` for each
   component, with a party and a category. Ask the Book's owner which ones.
4. `list_revenue_movement_links` with `externalKey` (a record),
   `statementId` (one item) or `revenueKey` (one revenue).
   `undo_revenue_movement` corrects one.

## 11. Web screen

Financeiro → Importações → **Receitas importadas**, like Extratos and Cartões:
- The records are filtered by state, pending by default: day, method,
  quantity, gross, discount, fee, paid, state.
- A pending record offers *Classificar*, which shows one party and financial
  category per component it carries, and applies to every day
  of that method. It also offers *Lançar* and *Ignorar*. A posted or ignored
  record offers *Desfazer*.
- *Importar receitas* uploads a report into the account chosen (the till for Yooga).
- The navigation counts the pending records.

## 12. Fixtures

`modules/finance-imports/src/parsers/yooga-payments/fixtures`:

| File | Proves |
|---|---|
| `day.csv` | Three methods, a discount on Pix, the TOTAL row skipped |
| `next-day.csv` | A later day posting on its own, with no discount |
| `mismatch.csv` | `bruto − desconto + acrescimo ≠ valor`: refused |
| `total-in-date.csv` | `TOTAL` written in the `data` column: skipped |
| `without-date.csv` | The old format, without `data` and `bruto`: refused |

Covered by:
- `yooga-payments/index.test.ts`;
- `finance-imports/src/application/yooga-payments.test.ts`;
- `packages/testing/src/integration/finance-revenue-movements.integration.ts`.

## 13. Open questions

Who pays each method's records is set on its `_bruto` descriptor (ADR 20):
- **Cash** (`Dinheiro`): `receivedAccountId` = the till. Posting makes the
  record's own receipt there, paid on its day, settling its revenues.
- **Vouchers** (`Vale Refeição`): `settlementGroup` (for example `vale`). The
  operators' deposits, whose descriptors name that group, fill the open
  records oldest first; what the operator keeps stays open (ROADMAP.md).
- **Cards and Pix:** nothing here; the acquirer's records name the method
  their gross settles (`stone-sales`).

None open.
