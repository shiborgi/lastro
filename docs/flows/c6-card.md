# Flow: `c6-card`

The card movement evidence family. It records both the expense and its
payments: one expense per purchase, settled into one invoice payment per
instalment.

**Status:** Implemented (0.1.0). Decisions (ADR 18):
- one link table for the expense and one for the payments;
- a card descriptor is a `descriptor_key` with a party, a financial category
  and the payment method;
- a purchase is saved as one expense and N payments on the right dates, from
  the card's billing windows (`account_cycles`, with the day each invoice is
  due);
- the expense key carries only the instalment count, the payment key the
  instalment number;
- every card printed on the file belongs to the one card account, and a
  line's value does not change;
- a refund becomes a discount; paying the invoice is a transfer from the
  paying account into the card;
- with no provider id, a line's `external_id` is the hash of the line.

**Import module:** `finance-imports`
**Importer id and version:** `c6/card`, version `1`
**Receiving module:** `finance`

Decisions: ADRs 13, 15, 16, 17 and 18.

## 1. Purpose

Record what the C6 card bought and what each invoice owes. A purchase
is one expense, a debt with one due date per instalment. Each instalment
settles into the card's payment for the invoice it is billed on. Every
purchase billed in a month joins that month's single payment, because a card
is paid once a month. Purchases whose merchant name is known post right away.
The rest wait for one classification, which is remembered for every later
invoice.

## 2. Source system and how the file is obtained

- The C6 card invoice. In the Book it is a `CARD` account; one account holds
  every card printed on the invoice.
- An invoice CSV is exported from the C6 app.
- The agent calls `import_movements` with:
  - the card's `accountId`;
  - `type: "card-movements"`;
  - the file's path as `key`;
  - the text as `content`.
- The card account's consumer row (`set_movement_consumer`, done once) says
  `card-movements` on that card is read by `c6/card`.
- The billing windows are registered by hand with
  `create_account_cycle`, one per invoice. No file states them.

## 3. File format and a redacted sample

- UTF-8 CSV with `;` as the delimiter.
- Nothing is quoted. There is one header row and no preamble.

| Column | Meaning |
|---|---|
| `Data de Compra` | The purchase date, `DD/MM/YYYY`. An instalment keeps its purchase's date |
| `Nome no Cartão` | The cardholder |
| `Final do Cartão` | The card's last four digits |
| `Categoria` | The issuer's merchant category; `-` when none |
| `Descrição` | The merchant |
| `Parcela` | `k/n`, or `Única` for a purchase paid whole |
| `Valor (em US$)`, `Cotação (em R$)` | `0` on domestic charges |
| `Valor (em R$)` | The instalment's billed amount. Positive is a charge; negative is a credit, such as the invoice paid (`Pag Fatura Boleto`) or a refund |

- A `;` inside a description changes the field count. The file is then
  refused, naming the row.

```text
Data de Compra;Nome no Cartão;Final do Cartão;Categoria;Descrição;Parcela;Valor (em US$);Cotação (em R$);Valor (em R$)
16/06/2026;EMPRESA EXEMPLO;1111;Materiais de construção para casa;MP *VIDRACARIA EXEMPLO;3/3;0;0;716.66
10/08/2026;EMPRESA EXEMPLO;1111;-;Pag Fatura Boleto;Única;0;0;-9827.29
18/04/2026;PESSOA EXEMPLO;2222;Educacional;ESCOLA EXEMPLO;5/12;0;0;362.08
15/08/2026;PESSOA EXEMPLO;2222;Supermercados;MERCADO EXEMPLO;Única;0;0;12.00
15/08/2026;PESSOA EXEMPLO;2222;Supermercados;MERCADO EXEMPLO;Única;0;0;12.00
```

## 4. File identity and replay behaviour

- **File:** identified by the sha256 of its text, the importer identity and
  the card account, as for account statements. The same content again
  answers `alreadyImported: true` and writes nothing but an audit event.
- **Line:** the file has no id, so each line has two hashes:
  - `statement_id`: the sha256 of the whole line, current instalment
    included. It is this invoice's line, unique per card, and what replay
    and overlap compare.
  - `external_id`: the sha256 of the line with `Parcela` reduced to the count
    (`/12`). It is the purchase, the same on every invoice, and every link's
    external key.

  The n-th identical line of a file (the two 12.00 above) gets `#n` on both,
  from the second on. The destination keys come from the external id:
  - **Expense key:** `<external_id>-<count>` (`…-12`): the purchase, linked to its expense.
  - **Payment key:** `<external_id>-<k>/<count>` (`…-5/12`): one instalment, linked to its invoice payment.
- **Overlap:** a line whose statement id is already staged is `known`.
- **The next invoice** shows the purchase's next instalment: a new statement
  id, the same external id. It attaches to the instalment its payment key
  names.
- **A changed past line:** a line's value does not change. Should it, the
  new text is another purchase.

## 5. Observations the parser returns

`CardObservation` (finance's type), one per line:

| Field | Type | Meaning |
|---|---|---|
| `occurredOn` | date | `Data de Compra`, a UTC day |
| `amount` | signed bigint, minor units | `Valor (em R$)`; zero refuses the file |
| `currency` | `"BRL"` | |
| `name`, `description` | string | `Descrição`; the normalized name is the descriptor key |
| `cardholder` | string or null | `Nome no Cartão` |
| `cardLast4` | string or null | `Final do Cartão` |
| `providerCategory` | string or null | `Categoria`, kept as information |
| `installmentNumber`, `installmentCount` | int | `Parcela`; `Única` is 1 of 1 |

Refusals (`IMPORT_FORMAT`, the whole file):
- another header;
- another field count;
- an unreadable date, amount or `Parcela`;
- no lines.

## 6. Receiving module and evidence family

Finance's card movement family (ADR 18):

| Table | Holds |
|---|---|
| `movement_files` | The intake ledger, shared with account statements (`movement_type` `card-movements`) |
| `card_movements` | One per instalment line: `statement_id` (this line), `external_id` (the purchase), payment key, expense key, purchase date, signed amount, name, descriptor key, cardholder, card, issuer category, instalment k of n, the party and financial category it posts with, status |
| `card_movement_descriptors` | One per card and `descriptor_key`: the party and financial category |
| `card_movement_expenses` | The expense link: per card and expense key, the expense |
| `card_movement_payments` | The payment link: per card and payment key, the instalment's invoice payment and settlement, and the line that showed it (null until that invoice is taken in) |
| `card_movement_transfers` | The transfer link of an invoice paid: the line, its statement key and the transfer |

At intake finance checks that the account exists and is a `CARD`.

## 7. Review states and who resolves them

| State | Meaning | Leaves by | Who |
|---|---|---|---|
| `PENDING` | Staged, not posted: a new name, a category of the wrong kind for its sign, or a purchase date no billing window holds | Classifying the descriptor, registering the window then `post_card_movement`, or ignoring | The agent or a person |
| `POSTED` | Its instalment link names it | `undo_card_movement` | The agent or a person |
| `IGNORED` | Not a purchase, with a reason | `undo_card_movement` | The agent or a person |

A line takes its party and financial category only from its descriptor.

A line is eligible to post when all three hold:
- both fields are filled;
- the category fits the sign: a charge (positive) takes an expense category
  that is not a DEDUCTION; a credit (negative, a refund) takes a DEDUCTION
  expense category;
- a billing window holds its purchase date.

The invoice paid (`Pag Fatura Boleto`) is a transfer. Its descriptor names the
account it is paid from and the payment method (`BOLETO`). Nothing is read
from the wording (ADR 16). It needs no billing window.

## 8. What posting creates in finance

| Case | Posting creates |
|---|---|
| A purchase's first line (any instalment) | The expense `card-<expense key>` (party, financial category, instalment amount × count, competence: the purchase month). Then the schedule: the window holding the purchase date names the first invoice, and instalment *i* falls on that invoice plus *i*−1 months. For each instalment it finds or opens, unpaid, the card's payment `card-<account>-<YYYY-MM>` (the method of the purchase's descriptor, set by the month's first purchase; due on that invoice's window `due_on`; for a month whose window is not registered yet, the first window's due day carried forward) and settles the instalment into it. It records one expense link and N payment links. This line attaches to its own instalment |
| A later invoice's line of the same purchase | Nothing new: it attaches to the instalment link its payment key names |
| A refund (negative, DEDUCTION category) | A discount: a negative expense `card-<expense key>` under the DEDUCTION category, settled into the payment of the invoice the refund is billed on, which it reduces |
| The invoice paid (negative, descriptor names an account) | A transfer from that account into the card, key `a<account>-BOLETO-a<card>-<day>-<amount>`. When the account statement's outflow already created it, the line joins it |

Undoing a posted line detaches it from its instalment. When no line of the
purchase remains posted, the instalment settlements are voided and both links
removed. The expense stays, and the next post of the purchase reuses it.

## 9. Cross-source checks

- **The invoice paid:**
  - The card's `Pag Fatura Boleto` and the C6 account's `BANCO C6 S.A.`
    outflow, the same amount on the same day in both files, are one transfer.
  - On the card, the descriptor names the C6 account. In C6, the descriptor
    names the card with `paymentMethod: BOLETO`, since the account line
    prints no method.
- **Invoice total:** the sum of a month's payment should equal the invoice's
  charges. It is not checked in version 1.

## 10. MCP tools an agent calls, in order

Once per card:

1. `create_account` with `type: "CARD"`. `list_accounts` returns its id.
2. `set_movement_consumer` with `accountId` (the card),
   `type: "card-movements"` and `importerId: "c6/card"`.
3. `create_account_cycle` (`referenceMonth`, `startsOn`, `endsOn`,
   `dueOn`) for every invoice whose window holds a purchase still being
   billed, and for the invoices ahead so each payment gets its own due date.
   An instalment 5/12 needs the window of its purchase month.

Per invoice:

4. `import_movements` with:
   - `accountId` (the card);
   - `type: "card-movements"`;
   - `key` (the file's path);
   - `content`;
   - the idempotency key `c6-card-<sha256>`.
5. When `pending` > 0, call `list_card_movements` with `status: "PENDING"`.
   Then, for each name, `classify_card_movement_descriptor` with `accountId`,
   `descriptorKey`, `partyId` and `financialCategoryId`. Ask the Book's owner when
   the Book cannot tell.
6. For a purchase waiting on a window: `create_account_cycle`, then
   `post_card_movement`.
7. For a refund, `classify_card_movement_descriptor` with a DEDUCTION
   expense category: it posts as a discount. For the invoice paid, the same
   tool with `counterAccountId` (the C6 account): a transfer.
8. `list_card_movement_links` shows what a purchase became.
   `undo_card_movement` (destructive) corrects one.

## 11. Web screen

Financeiro → Importações → **Cartões**:
- The lines are filtered by state, pending by default. Each shows the
  purchase date, card, merchant, instalment, classification, state and
  amount.
- A pending line offers *Classificar* (party and financial category, for
  every line with that name), *Lançar* and *Ignorar*. A posted or ignored
  line offers *Desfazer*.
- *Importar fatura* uploads a CSV as `card-movements`.
- The navigation counts the pending lines.

## 12. Fixtures

`modules/finance-imports/src/parsers/c6-card/fixtures`, redacted:

| File | Proves |
|---|---|
| `august.csv` | A 3/3 instalment, the invoice paid (a credit), a 5/12 instalment of an April purchase, two identical lines |
| `september.csv` | The 6/12 instalment attaching to the schedule; a new merchant |
| `malformed.csv` | A `;` in a description: refused, naming the row |

Covered by:
- `c6-card/index.test.ts` (the parser);
- `finance/src/domain/cards.test.ts` (keys and schedule);
- `finance-imports/src/application/cards.test.ts` (the flow over memory);
- `packages/testing/src/integration/finance-cards.integration.ts`
  (PostgreSQL and the triggers).

## 13. Open questions

1. **Due date of a payment opened before its window.** A payment created
   from a carried-forward due day keeps it when the month's window is
   registered later; register the windows ahead.
2. **A refund larger than the month's charges** would make the invoice
   payment negative, which finance refuses.
