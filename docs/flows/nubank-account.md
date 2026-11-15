# Flow: `nubank-account`

A business checking account at Nubank, line by line.

**Status:** Implemented (0.1.0). It created the account movement evidence
family that `c6-account` and `stone-account` reuse (ADR 17). Decisions:
- sending a file again never duplicates a line;
- lines are staged as payment and receipt movements; descriptors, keyed by
  the normalized name, give the party and financial category or the other
  account, and the payment method;
- a line posts at once when the other end and the method are known;
- every link carries the statement key `<from>-<METHOD>-<to>-YYYYMMDD-<amount>`.
**Import module:** `finance-imports`
**Importer id and version:** `nubank/account`, version `1`
**Receiving module:** `finance`

Decisions: ADRs 13, 15, 16 and 17.

## 1. Purpose

Tell the Book what moved through the Nubank checking account, line by
line. Lines whose name Lastro already knows (a filled descriptor) are
recorded right away. The rest wait
for one decision each, which is then remembered for every later file.

## 2. Source system and how the file is obtained

- Nubank PJ checking account, in the Book as an `ACCOUNT` with its number.
- A month is exported from the Nubank app (Account → statement → export
  CSV). The file is named `NU_<account>_<DDMMMYYYY>_<DDMMMYYYY>.csv`; the name
  is not read.
- The agent calls `import_movements` with the Book, the Nubank account,
  `type: "account-movements"`, the file's path as `key` and the file's text.
  It may send the same file as often as it likes.
- The account and type pick the importer: the Book's consumer row
  (`set_movement_consumer`, once) says the Nubank account's
  `account-movements` is read by `nubank/account`. The key is kept as
  provenance and proves nothing.

## 3. File format and a redacted sample

- UTF-8 CSV, comma-delimited, no quoting, one header row, no preamble.

| Column | Meaning |
|---|---|
| `Data` | The movement's date, `DD/MM/YYYY`. No time |
| `Valor` | Signed amount in reais, dot decimal: negative is money out |
| `Identificador` | Nubank's id for the movement, a UUID |
| `Descrição` | The kind of movement; for a Pix, the counterparty's name, masked document, bank and branch/account |

- A description with a comma changes the field count; the file is refused,
  naming the row, rather than read with shifted columns.

```text
Data,Valor,Identificador,Descrição
06/01/2026,165.00,00000000-0000-4000-8000-000000000001,Transferência recebida pelo Pix - EMPRESA EXEMPLO LTDA - 00.000.000/0001-00 - BCO C6 S.A. (0336) Agência: 1 Conta: 12345678-9
06/01/2026,-164.50,00000000-0000-4000-8000-000000000002,Pagamento de fatura
07/01/2026,-1364.01,00000000-0000-4000-8000-000000000003,Transferência enviada pelo Pix - FORNECEDOR EXEMPLO - •••.000.000-•• - ITAÚ UNIBANCO S.A. (0341) Agência: 0000 Conta: 00000-0
```

## 4. File identity and replay behaviour

- **File:** sha256 of its text, the importer identity (id, version,
  configuration fingerprint) and the account. The same file again answers
  `alreadyImported: true` with the first intake's file and writes nothing but
  an audit event. A repeated idempotency key answers the first result.
- **Line:** `Identificador`, unique per account across every file.
- **Overlapping files:** known lines are counted as `known` and keep their
  state; new lines are staged.
- **A changed past line:** a known `Identificador` with another date or
  amount refuses the whole file (`MOVEMENT_CONFLICT`); a person decides.
  A changed description only is accepted and the staged text stays.
- **A parser version change** gives a new fingerprint and a new intake; lines
  still dedupe by `Identificador`.

## 5. Observations the parser returns

`AccountMovementObservation` (finance's type), one per line:

| Field | Type | Meaning |
|---|---|---|
| `externalId` | string | `Identificador`; a blank one refuses the file |
| `name` | string | `Descrição` as printed; its normalization is the `descriptor_key`. Nothing is extracted from it |
| `occurredOn` | date | `Data`, a UTC day |
| `occurredAt` | null | The file has no time; none is invented |
| `amount` | signed bigint, minor units | `Valor` read as digits; zero refuses the file |
| `currency` | `"BRL"` | |
| `description` | string | `Descrição`, trimmed |

Refusals (`IMPORT_FORMAT`, the whole file): another header, another field
count, an unreadable date or amount, a blank id, no lines.

## 6. Receiving module and evidence family

Finance's account movement family (ADR 17):

| Table | Holds |
|---|---|
| `movement_consumers` | Per account and type, the importer that reads it |
| `movement_files` | The intake ledger: account, type, importer id, version and fingerprint, content sha256, source key, line and new counts, who and when |
| `payment_movements` | Lines that took money out (negative `Valor`), positive amount: external id, date, amount, name, descriptor key, description, payment method, mapping, status |
| `receipt_movements` | Lines that brought money in (positive `Valor`) |
| `payment_movement_descriptors`, `receipt_movement_descriptors` | One per account and `descriptor_key`: the party and financial category, or the other account, and optionally the payment method it is posted with |
| `payment_movement_links`, `receipt_movement_links` | What a posted line became, each with its statement key: a transfer, or an expense and payment (a revenue and receipt) |

At intake finance checks the account exists and is an `ACCOUNT`.

## 7. Review states and who resolves them

| State | Meaning | Leaves by | Who |
|---|---|---|---|
| `PENDING` | Staged, not mapped enough to post (no other end, or no payment method) | Classifying its descriptor, posting, or ignoring | The agent or a person |
| `POSTED` | Has links adding up to its amount | `undo_payment_movement` or `undo_receipt_movement`, back to `PENDING` | The agent or a person |
| `IGNORED` | Deliberately not a record, with a reason | `undo_payment_movement` or `undo_receipt_movement`, back to `PENDING` | The agent or a person |

A line's mapping comes only from its descriptor: when its `descriptor_key`
matches one, the line takes its data (a counter account makes it a transfer,
a party a payment or receipt); otherwise a new, empty descriptor is created
and the line waits for its fields. Nothing is taken out of the description. The payment method is the descriptor's, never
read from the wording (ADR 16). A line posts on its own only when the other end and the
payment method are both known.

## 8. What posting creates in finance

| Mapping | Posting creates | Link |
|---|---|---|
| Another account of the Book | A transfer between the two accounts on that day; when a link with the same statement key already names a transfer with no link on this side, the line joins it instead | transfer, key `a<from>-PIX-a<to>-20260106-16500` |
| Party and EXPENSE category (money out) | A new expense (competence: the line's month) and a payment from the account on the line's date settling it | expense + payment, key `a<account>-PIX-p<party>-…` |
| Party and REVENUE category (money in) | A new revenue and a receipt into the account settling it | revenue + receipt, key `p<party>-PIX-a<account>-…` |
| `expenses: [{expenseId, amount}]` given (money out) | One payment settling those existing expenses, shares adding up to the line | one link per expense |
| `revenues: [{revenueId, amount}]` given (money in) | One receipt settling those revenues | one link per revenue |

Posting happens at intake when the mapping is complete, when a descriptor is
classified (its pending lines), or by `post_payment_movement` /
`post_receipt_movement`. Undoing removes the
links, voids the settlements the post made, and removes a transfer no other
link names. An expense or revenue the post created stays and is reused by the
next post of that line with the same classification.

## 9. Cross-source checks

- **Own-account transfers:** once the Nubank descriptor of the business's own
  name is filled with the C6 account, a Pix from C6 is posted as a transfer
  with statement key `a<C6>-PIX-a<Nubank>-<day>-<amount>`. When `c6-account`
  lands, the C6 outflow (its descriptor filled with the Nubank account)
  computes the same key and joins that transfer instead of creating one. `list_payment_movement_links` and `list_receipt_movement_links` with `statementKey` show each side.
- **Balance:** the file has no balance column; not checked in version 1.

## 10. MCP tools an agent calls, in order

Once per Book (after bootstrap):

1. `list_accounts`: the Nubank account's id (`type: ACCOUNT`, with its
   `number`). The Book's other accounts carry their numbers too, which helps
   the agent tell a Pix between them.
2. `set_movement_consumer` with `accountId` (Nubank), `type:
   "account-movements"`, `importerId: "nubank/account"`.

Per file:

3. `import_movements` with `bookId` (optional, must be the credential's),
   `accountId` (Nubank), `type: "account-movements"`, `key` (the file's path),
   `content`, and idempotency key `nubank-<sha256 of the file>`. Answers
   `new`, `known`, `posted`, `pending`.
4. When `pending` > 0: `list_payment_movements` (money out) and
   `list_receipt_movements` (money in) with `status: "PENDING"`.
5. For each pending name, decide what it always is, and
   `classify_payment_movement_descriptor` or
   `classify_receipt_movement_descriptor` with `accountId`, `descriptorKey`
   and either `partyId` + `financialCategoryId` or `counterAccountId`, plus
   `paymentMethod` when the line has none. Its pending
   lines post at once, and later files post on their own. Ask the Book's owner when
   the party or financial category cannot be told from the Book
   (`list_parties`, `list_financial_categories`, earlier posted lines).
6. For a line that pays expenses already in the Book: `post_payment_movement`
   with `expenses: [{expenseId, amount}]` (`list_open_expenses` finds them);
   for one that receives revenues, `post_receipt_movement` with `revenues`.
7. For a line that is not a financial fact: `ignore_payment_movement` or
   `ignore_receipt_movement` with a reason.
8. `undo_payment_movement` or `undo_receipt_movement` (destructive,
   `confirmation: "confirm"`) to correct one;
   `list_payment_movement_links` or `list_receipt_movement_links` to see what
   a line became.

## 11. Web screen

Financeiro → Importações → **Extratos**: the lines filtered by state (pending by default),
with date, account, description, classification, state and signed amount; a
pending line offers *Classificar* (a party and financial category, or a
transfer account, and the payment method; it applies to every line with that
name) and *Ignorar*;
a posted or ignored one offers *Desfazer*. *Importar extrato* uploads a CSV as `account-movements`
for the chosen account, read by its consumer.
Financeiro → Importações → **Arquivos** lists every file taken in. The navigation counts pending lines.

## 12. Fixtures

`modules/finance-imports/src/parsers/nubank-account/fixtures`, redacted:

| File | Proves |
|---|---|
| `month.csv` | A Pix in from the C6 account, an invoice payment with no method and a supplier Pix; all pending on a new Book |
| `overlap.csv` | One known line and one new line by the same supplier |
| `changed.csv` | A known id with another amount: refused |
| `malformed.csv` | A comma in a description: refused, naming the row |

Covered by `nubank-account/index.test.ts` (parser),
`finance-imports/src/application/statements.test.ts` (the flow over
memory), `packages/testing/src/integration/finance-statements.integration.ts`
(PostgreSQL, including the C6 side joining by statement key) and the smoke
test (a consumer and two intakes over MCP).

## 13. Open questions

1. **`Pagamento de fatura`.** There is no Nubank card; this line pays some
   other bill, and its wording names no method. It stays pending until its
   descriptor is classified with a party, a financial category and a payment
   method, decided on the first real file.
2. **Balance check.** Not in version 1.
