# Flow: `c6-account`

The business's C6 checking account. It works like `nubank-account`: the same
account movement family, consumer, descriptors, links and statement keys
(ADR 17). The only difference is that a line has no provider id.

**Status:** Implemented (0.1.0): the Nubank flow applied to C6. A line with
no provider id is identified by the hash of the line, with a counter for
identical movements of the same day (ADR 15).
**Import module:** `finance-imports`
**Importer id and version:** `c6/account`, version `1`
**Receiving module:** `finance`

Decisions: ADRs 13, 15, 16 and 17; it reuses `nubank-account`'s family.

## 1. Purpose

Tell the Book what moved through the C6 account, line by line. Lines whose
name has a filled descriptor (and a known payment method) post at once. The
rest wait for one classification, which is then remembered.

## 2. Source system and how the file is obtained

- The C6 checking account, in the Book as an `ACCOUNT` with its number.
- A period is exported from the C6 app.
- the agent calls `import_movements` with:
  - the C6 `accountId`;
  - `type: "account-movements"`;
  - the file's path as `key`;
  - the text as `content`.
- Set once: `set_movement_consumer` with the C6 account,
  `account-movements` and `c6/account`.

## 3. File format and a redacted sample

- CSV, comma-delimited, with quoting (RFC 4180). A quoted field may carry a
  comma or trailing spaces.
- Five lines of prose come before the header, which is found by its first
  column.

| Column | Meaning |
|---|---|
| `Data Lançamento` | The movement's date, `DD/MM/YYYY` |
| `Data Contábil` | The accounting date |
| `Título` | A counterparty or the kind of movement (`CRED LOJ C DEBITO` on a card settlement) |
| `Descrição` | The rest of the wording (`TRANSF ENVIADA PIX`, `CART. DEBIT - Stone Pagamento, Maestro`) |
| `Entrada(R$)`, `Saída(R$)` | Money in and money out; one is always `0.00` |
| `Saldo do Dia(R$)` | The day's balance |

```text
EXTRATO DE CONTA CORRENTE C6 BANK

Agência: 1 / Conta: 123456789
…
Data Lançamento,Data Contábil,Título,Descrição,Entrada(R$),Saída(R$),Saldo do Dia(R$)
06/01/2026,06/01/2026,Pix enviado para EMPRESA EXEMPLO LTDA,TRANSF ENVIADA PIX,0.00,165.00,1000.00
07/01/2026,07/01/2026,CRED LOJ C DEBITO,"CART. DEBIT - Stone Pagamento, Maestro ",937.03,0.00,2049.06
10/01/2026,10/01/2026,BANCO C6 S.A.,BANCO C6 S.A.,0.00,982.73,1066.33
12/01/2026,12/01/2026,Pix enviado para FORNECEDOR EXEMPLO,TRANSF ENVIADA PIX,0.00,45.00,976.33
12/01/2026,12/01/2026,Pix enviado para FORNECEDOR EXEMPLO,TRANSF ENVIADA PIX,0.00,45.00,976.33
```

Real exports include identical same-day lines, and acquirer card
settlements in an older and a newer wording (`CRED LOJ C DEBITO` /
`CRED LOJ - CART DEBI STONE…`). Names and amounts here are redacted.

## 4. File identity and replay behaviour

- **File:** as for Nubank. The same content again answers
  `alreadyImported: true`.
- **Line:** the file has no id, so `external_id` is the sha256 of the line's
  columns except `Saldo do Dia`. The day's balance grows during the day, and
  an export taken mid-day would otherwise give the same movement another
  hash.
- **Identical movements of one day** (the two 45.00 above) get a counter:
  the first has the hash alone, then `#2`, `#3`. A later export with both
  gives one `known` and one `new`, so nothing is staged twice.
- **Overlap:** a line whose key is already staged is `known`. A line's value
  does not change.

## 5. Observations the parser returns

`AccountMovementObservation`, one per line:

| Field | Value |
|---|---|
| `externalId` | `null`: finance hashes `line` |
| `line` | The identity columns rejoined |
| `occurredOn` | `Data Lançamento` |
| `amount` | `Entrada` − `Saída`, signed minor units; both non-zero, or both zero, refuses the file |
| `name`, `description` | `Título` and `Descrição` joined as printed. On a real export each field alone merges counterparties, and the pair separates them all |

Nothing else is read from the wording: the payment method, like the party,
category or account, comes from the descriptor (ADR 16).

## 6–8. Evidence, review states, posting

The same as `nubank-account`, sections 6 to 8:
- negative lines become `payment_movements`, positive ones
  `receipt_movements`;
- only the descriptor maps a line;
- posting needs the other end and the payment method;
- the links carry the statement key.

## 9. Cross-source checks

- **The Pix between C6 and Nubank:**
  - The C6 outflow's descriptor, filled with the Nubank account, computes
    `a<C6>-PIX-a<Nubank>-<day>-<amount>`.
  - The Nubank inflow, filled with the C6 account, computes the same key.
  - Whichever posts second joins the first one's transfer.
- **The card invoice paid** (`BANCO C6 S.A.`, monthly, around the 10th) is a
  transfer into the card. Its descriptor names the card
  with `paymentMethod: BOLETO`, and it joins the card's `Pag Fatura Boleto`
  by statement key (`docs/flows/c6-card.md`, ADR 18).
- **Card settlements from Stone** (`CRED LOJ …`) are Stone's repayments
  arriving. As `stone-payouts` describes, the Stone promise and
  this C6 confirmation point to the same receipt, matched by the statement
  key `p<Stone>-<METHOD>-a<C6>-<day>-<amount>`.

- **Voucher deposits** (`RECEBIMENTO DE TED … PLUXEE …`, `Pix recebido de
  ALELO …`) are an operator paying voucher sales (ADR 20). Their descriptors
  name the operator, the payment method and the `settlementGroup` the Yooga
  `Vale Refeição` gross names, with no financial category: the deposit fills
  the open voucher sales oldest first, and what the operator keeps stays open.

## 10. MCP tools an agent calls, in order

Once:
1. `list_accounts`.
2. `set_movement_consumer` (C6, `account-movements`, `c6/account`).

Per file, as in Nubank:
3. `import_movements`.
4. `list_payment_movements` and `list_receipt_movements` with
   `status: "PENDING"`.
5. `classify_payment_movement_descriptor` or
   `classify_receipt_movement_descriptor`.
6. `post_…`, `ignore_…`, `undo_…` and `list_…_links` of the line's side
   (`payment_movement` or `receipt_movement`), as needed.

## 11. Web screen

Financeiro → Importações → **Extratos**, the same screen as Nubank.

## 12. Fixtures

`modules/finance-imports/src/parsers/c6-account/fixtures`, redacted:

| File | Proves |
|---|---|
| `month.csv` | Preamble skipped; a Pix to the Nubank side; card settlements (a quoted comma); the invoice paid; two identical Pix on one day |
| `overlap.csv` | One identical line known, one new |
| `both.csv` | A line with both an inflow and an outflow: refused |

Covered by:
- `c6-account/index.test.ts` (the parser);
- `finance-imports/src/application/c6-account.test.ts` (memory, including
  the transfer with Nubank);
- `finance-statements.integration.ts` (PostgreSQL).

## 13. Open questions

1. **Transfers to the business's own name.** A Pix sent to the business's
   own name may go to more than one of its accounts; one descriptor maps them
   all to one account. When they go to several, the lines are posted one by
   one with `post_payment_movement`.
