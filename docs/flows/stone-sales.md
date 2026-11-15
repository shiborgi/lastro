# Flow: `stone-sales`

What Stone, the business's acquirer, says it captured, summed per day, product and
brand. Its gross is what the point of sale already recorded as paid; what
Stone keeps becomes the acquirer's fee revenue.

**Status:** Implemented (0.1.0). The export is read as a summary per day,
product and brand, never one sale at a time. Its gross is what the point of
sale already recognized and is not recognized again; what Stone keeps is a
new revenue line, negative, so the day's lines add up to what will be
received: gross sold − discount + tip − acquirer fee (ADR 19).
**Import module:** `finance-imports`
**Importer id and version:** `stone/sales`, version `1`
**Receiving module:** `finance`

Decisions: ADRs 15, 16, 19 and 20.

## 1. Purpose

Record what Stone keeps from the card, Pix and voucher sales, as a
deduction from the revenue the point of sale recognized (`yooga-payments`).
The record also keeps Stone's gross and net, for the day's check against
Yooga and, later, against Stone's repayments.

## 2. Source system and how the file is obtained

- Stone's portal exports `vendas_<from>_<to>_<id>.csv`.
- The agent calls `import_movements` with:
  - the Stone account's `accountId`;
  - `type: "revenue-movements"`;
  - the file's path as `key`;
  - the text as `content`.
- Set once: `set_movement_consumer` (Stone account, `revenue-movements`,
  `stone/sales`).

## 3. File format and a redacted sample

- `;`-delimited, one header row, one row per sale.
- Amounts carry six decimal places, a comma and a thousands dot
  (`1.686,000000`). Discounts are printed negative.

| Column (read) | Meaning |
|---|---|
| `DATA DA VENDA` | `DD/MM/YYYY HH:MM`, São Paulo; the day is the record's |
| `PRODUTO`, `BANDEIRA` | Product and brand as printed (`Debito MasterCard`; Pix has no brand) |
| `STONE ID` | Stone's id, named in a refusal |
| `VALOR BRUTO` | The sale |
| `DESCONTO DE MDR`, `DESCONTO DE ANTECIPACAO`, `DESCONTO UNIFICADO` | What Stone keeps, negative |
| `VALOR LIQUIDO` | What Stone repays: gross + discounts |
| `ULTIMO STATUS` | Only `Aprovada` is a captured sale |

```text
DOCUMENTO;STONECODE;DATA DA VENDA;BANDEIRA;PRODUTO;STONE ID;N DE PARCELAS;VALOR BRUTO;VALOR LIQUIDO;DESCONTO DE MDR;DESCONTO DE ANTECIPACAO;DESCONTO UNIFICADO;…;ULTIMO STATUS;…
…;08/11/2026 23:04;MasterCard;Debito;41000000000001;1;15,400000;15,132040;-0,267960;0,000000;0,000000;…;Aprovada;…
…;08/11/2026 22:40;;Pix QRcode;E00000000000000000000000000000001;;48,180000;47,820000;-0,360000;0,000000;0,000000;…;Aprovada;…
```

## 4. File identity and replay behaviour

- **File:** as for every statement.
- **Record:** the approved sales of one day, product and brand. It has no
  source id, so `external_id` is the hash of `<day>;<name>;<net>`, as for
  `yooga-payments`. A record already staged is `known`.
- **Item:** the acquirer fee link's `statement_id` is the hash of
  `<external_id>;taxa_adquirente;<amount>`, and its `revenue_key` is
  `<external_id>-taxa_adquirente`.

## 5. Observations the parser returns

`RevenueObservation`, one per day, product and brand:
- `occurredOn`, `name` (product and brand as printed), `quantity`;
- `gross`: the summed gross;
- `acquirerFee`: the summed discounts, as a positive amount;
- `discount` and `fee`: zero;
- `amount`: gross − acquirer fee, the net Stone will pay;
- `grossRecognized: false`.

The six places are summed, then rounded once to cents, half up.

Refusals (`IMPORT_FORMAT`):
- another header;
- an unreadable amount or time;
- an approved sale whose gross and discounts do not make its net;
- no approved sale.

## 6. Receiving module and evidence family

The revenue movement family of `yooga-payments` (ADR 19):

| Table | Holds |
|---|---|
| `revenue_movements` | One per record: gross (not recognized here), acquirer fee, net |
| `revenue_movement_descriptors` | Per Stone account: `<product_brand>_taxa_adquirente`, with the party and a DEDUCTION REVENUE category |
| `revenue_movement_links` | The acquirer fee's revenue |

## 7. Review states and who resolves them

As in `yooga-payments`: PENDING until its `_taxa_adquirente` descriptor is
filled, then POSTED; `ignore_revenue_movement` and `undo_revenue_movement`.

## 8. What posting creates in finance

One revenue: minus the acquirer fee, on the sale day, under the descriptor's
DEDUCTION REVENUE category. No gross revenue and no receipt.

For a day, the revenues of both sources are:

| Line | From |
|---|---|
| Gross sold | `yooga-payments` `_bruto` |
| − Discount | `yooga-payments` `_desconto` |
| + Tip (service fee) | `yooga-payments` `_taxa` |
| − Acquirer fee | `stone-sales` `_taxa_adquirente` |

Their sum is what will be received.

## 9. Cross-source checks

- **Yooga's paid amount.** Stone's gross per day and method should equal
  Yooga's `valor` for that method. Stone splits it by brand, so the sums
  compare across brands. Not checked in version 1 (P6.8).
- **The repayments.** The net is what `stone-payouts` receives: a deposit
  settles the group's open records whose nets add up to it, their gross into
  the point of sale's revenues and their fee into the fee revenue (ADR 20).

## 10. MCP tools an agent calls, in order

1. Once: `set_movement_consumer` (Stone account, `revenue-movements`,
   `stone/sales`).
2. Per export: `import_movements`.
3. `list_revenue_movement_descriptors` with `classified: "false"`, then
   `classify_revenue_movement_descriptor` per product and brand: the
   acquirer as party, a DEDUCTION REVENUE category, the `settlementGroup` of
   the deposits that pay it (one per mode and brand of the payout report,
   such as `stone-debito-mastercard`) and the point of sale's method its
   gross settles (`settlesMethodKey`, such as `debito`). Ask the Book's owner when
   the Book cannot tell.

## 11. Web screen

Financeiro → Importações → **Receitas importadas**, with the Yooga records: day, method,
quantity, gross, discount, fee, acquirer fee, amount to receive, state.

## 12. Fixtures

`modules/finance-imports/src/parsers/stone-sales/fixtures`:

| File | Proves |
|---|---|
| `november.csv` | Two debit sales summed and rounded once, a Pix, a credit, a cancelled sale left out |
| `mismatch.csv` | An approved sale whose net is not gross + discounts: refused |

Covered by:
- `stone-sales/index.test.ts`;
- `finance-imports/src/application/stone-sales.test.ts`;
- `packages/testing/src/integration/finance-revenue-movements.integration.ts`.

## 13. Open questions

1. **Credit instalments.** A sale in instalments is summed whole on the sale
   day; its repayment comes one instalment a month (ROADMAP.md).
