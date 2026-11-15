# Flow: `stone-account`

The business's Stone account: the Pix it sends to other accounts, and the Pix
sales it receives, summed per day. It is the account movement family of `nubank-account` and `c6-account`
(ADRs 16, 17 and 19).

**Status:** Implemented (0.1.0). Two kinds of line are read: the Pix the
account sends to other accounts (`Débito, Pix, Enviado`), and the Pix sales
it receives, summed per day (ADR 20).
**Import module:** `finance-imports`
**Importer id and version:** `stone/account`, version `2`
**Receiving module:** `finance`

Decisions: ADRs 15, 16, 17 and 20.

## 1. Purpose

Record the money that leaves the Stone account, mostly the Pix that moves
the day's Pix sales to the C6 account. Each one is a transfer to another
account of the Book, or a payment to someone, as its descriptor says. The
Pix sales received become one receipt per day that settles the day's Pix.

## 2. Source system and how the file is obtained

- The Stone account, in the Book as an `ACCOUNT`.
- The statement is exported from Stone's portal.
- The agent calls `import_movements` with:
  - the Stone account's `accountId`;
  - `type: "account-movements"`;
  - the file's path as `key`;
  - the text as `content`.
- Set once: `set_movement_consumer` (Stone account, `account-movements`,
  `stone/account`).

## 3. File format and a redacted sample

- Comma-delimited with quoting, newest first.
- Amounts are `"-3.009,75"` and balances `"R$ 3.009,75"`.

| Column (read) | Meaning |
|---|---|
| `Movimentação`, `Tipo`, `Situação` | Only `Débito`, `Pix`, `Enviado` is read |
| `Valor` | The Pix, negative |
| `Tarifa` | `Grátis` on every Pix sent; a fee refuses the file |
| `Data`, `Horário` | São Paulo, to the millisecond |
| `Destino`, `Destino Instituição` | Who received it and where |

```text
Movimentação,Tipo,Valor,Saldo antes,Saldo depois,Tarifa,Data,Horário,Situação,Nosso Número,Destino,Destino Documento,Destino Instituição,…
Débito,Pix,"-3.009,75","R$ 3.009,75","R$ 0,00",Grátis,09/11/2026 16:28,16:28:27.226,Enviado,,EMPRESA EXEMPLO LTDA,…,Banco C6 S.A.,…
```

A real file sends Pix, all free, to the Book's other accounts and to
people. A Pix received outside a sale (`Crédito, Pix, Recebido`) is skipped.

## 4. File identity and replay behaviour

- **File:** as for every statement.
- **Line:** the file has no id (`Nosso Número` is empty), so `external_id`
  is the sha256 of the line. The time is to the millisecond and the balances
  are in the line, so no two lines repeat. The same counter as in C6 applies
  should they.
- **Links:** `external_key` is the external id. A transfer link carries the
  `statement_key` `a<Stone>-PIX-a<other>-<day>-<amount>`.

## 5. Observations the parser returns

`AccountMovementObservation`:
- `externalId` null (finance hashes `line`);
- `occurredOn` and `occurredAt`;
- `amount` negative;
- `name` = `Tipo Destino Destino Instituição` as printed (for example
  `Pix EMPRESA EXEMPLO LTDA Banco C6 S.A.`). Nothing is extracted from it.

## 6–8. Evidence, review states, posting

As in `nubank-account`:
- each Pix sent is a `payment_movements` line;
- its descriptor names another account of the Book (a transfer) or a party
  and an EXPENSE category (a payment), and the payment method (`PIX`);
- nothing is inferred from the name.

## 9. Cross-source checks

- **The day's Pix moved to C6.** The Stone outflow's descriptor names the C6
  account; the C6 inflow's names the Stone account. Both compute
  `a<Stone>-PIX-a<C6>-<day>-<amount>` and meet in one transfer.
- **Balance:** the file's `Saldo antes`/`Saldo depois` hold on every line;
  not checked in version 1.

## 10. MCP tools an agent calls, in order

1. Once: `set_movement_consumer` (Stone account, `account-movements`,
   `stone/account`).
2. `import_movements`.
3. `classify_payment_movement_descriptor` for each destination: the other account
   and `paymentMethod: "PIX"`, or a party and category. Ask the Book's owner when
   the Book cannot tell.

## 11. Web screen

Financeiro → Importações → **Extratos**, as the other accounts.

## 12. Fixtures

`modules/finance-imports/src/parsers/stone-account/fixtures/month.csv`:
two Pix sent (to the business at C6, and to a person), and a sale and a Pix
received, which are skipped.

Covered by:
- `stone-account/index.test.ts`;
- `finance-imports/src/application/stone-account.test.ts`, which includes
  the transfer joined by the C6 statement.

## Pix sales received (version 2, ADR 20)

- **Read:** `Crédito`, `Transação`, `FINISHED`: one Pix sale each, `Valor`
  its gross and `Tarifa` Stone's fee; the account is credited the net.
- **Summed per day** into one receipt movement: amount Σ(`Valor` −
  `Tarifa`), name `Transação`, line `<day>;Transação` (so its external id is
  the day's; a later export with more sales of that day is refused, not
  counted twice).
- **Posting:** its descriptor names Stone, `PIX` and the `settlementGroup`
  of the `stone-sales` Pix record (for example `stone-pix`), with no
  financial category: one receipt in the Stone account that settles the
  day's Yooga Pix revenues and Stone's Pix fee (ADR 20).
- **Checked against real exports:** the transactions are as many as the
  approved Pix sales in `stone-sales`, and every day nets to the cent.

## 13. Open questions

None. What each destination is (another account, or a party and category) is
the descriptor's, set when it is classified (ADR 16).
