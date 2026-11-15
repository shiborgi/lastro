# finance

**Owns:** institutions, accounts and their billing windows, parties,
financial categories; expenses, payments, revenues, receipts, their
settlements, transfers; account movement evidence: the consumer each
account's content is read by, the files taken in, their payment and receipt
movements, the descriptors that classify them, and the links from a movement
to the records it became (ADR 17); card movement evidence: invoice lines,
card descriptors and the expense and instalment links of each purchase
(ADR 18); revenue movements, a day's sales by method (ADR 19).

**Depends on:** `kernel`, `core`

The chart of accounts is called *financial categories* everywhere, from the
table `financial_categories` to the MCP tools, so it never reads as a
product category (sales' `product_categories`).

Finance does not know any module that depends on it (ADR 11); it never reads
another module's tables. There are no receivables (ADR 7): what is still to
be received is revenue no receipt has settled yet.

## Public interface

`host.modules.finance` (`FinanceApi`, `src/application/module.ts`). Every
function takes the caller's `Scope` first, so a call made inside another
module's write runs on that write's transaction.

| Member | Use |
|---|---|
| `catalog.getAccount`, `getParty`, `getFinancialCategory` | One record of the scope's Book, or null |
| `catalog.listAccounts`, `listParties`, `listFinancialCategories` | The Book's records, financial categories filtered by `kind` |

| `expenses.totalByRole(scope, { from, to, role })` | Signed sum per currency of the expenses whose competence month is in [from, to) and whose financial category has the role, own or its group's |
| `statements.consumerOf(scope, accountId, movementType)` | The importer id set for that account and type, or null |
| `statements.setConsumer(scope, { accountId, movementType, importerId })` | Route an account's content of a type to an importer; the id stays opaque here |
| `statements.listConsumers(scope, { accountId? })` | Every consumer set |
| `cards.intake(scope, { accountId, movementType, importer, contentSha256, sourceKey, observations })` | Take in one card invoice's lines into a CARD: the same content answers its first intake; a staged payment key counts as known; eligible purchases post at once. Called by `finance-imports` |
| `revenueMovements.intake(scope, { accountId, movementType, importer, contentSha256, sourceKey, observations })` | Take in a day's sales by method (point of sale or acquirer); records whose component descriptors are filled post as revenues, never a receipt |
| `accountMovements.intake(scope, { accountId, movementType, importer, contentSha256, sourceKey, observations })` | Take in one content's observations: the same content again answers its first intake; lines already staged count as known; a changed known line refuses it; lines whose mapping is complete are posted at once. Called by `finance-imports` |

The card instalment schedule (one purchase billed across several cycles)
belongs to the card evidence: `docs/flows/c6-card.md`.

## Operations

The catalogs share one shape (`defineCrudOperations` in the kernel): list,
create, update and delete, with the update naming at least one field and the
delete marked destructive.

| Resource | Operation ids | HTTP (under the Book) | MCP tools |
|---|---|---|---|
| Institution | `finance.{list,create,update,delete}Institution(s)` | `/institutions`, `/institutions/:id` | `list_institutions`, `create_institution`, `update_institution`, `delete_institution` |
| Account | `finance.…Account(s)` | `/accounts` | `…_account(s)` |
| Billing window | `finance.…AccountCycle(s)` | `/account-cycles` | `…_account_cycle(s)` |
| Party | `finance.…Party / Parties` | `/parties` | `…_party / list_parties` |
| Financial category | `finance.…FinancialCategory / FinancialCategories` | `/financial-categories` | `…_financial_category / list_financial_categories` |

### Expense cycle

| Operation | Access | HTTP | MCP tool |
|---|---|---|---|
| `finance.createExpense` | write | `POST /expenses` | `create_expense` |
| `finance.listExpenses` | read | `GET /expenses` | `list_expenses` |
| `finance.getExpense` | read | `GET /expenses/:id` | `get_expense` |
| `finance.listOpenExpenses` | read | `GET /open-expenses` | `list_open_expenses` |
| `finance.createPayment` | write | `POST /payments` | `create_payment` |
| `finance.listPayments` | read | `GET /payments` | `list_payments` |
| `finance.getPayment` | read | `GET /payments/:id` | `get_payment` |
| `finance.settleExpense` | write | `POST /expense-settlements` | `settle_expense` |
| `finance.payExpense` | write | `POST /expenses/:expenseId/pay` | `pay_expense` |
| `finance.voidExpenseSettlement` | write, destructive | `POST /expense-settlements/:id/void` | `void_expense_settlement` |

- `createExpense` takes positive amounts in a plain EXPENSE financial
  category. A negative expense exists only as a discount obtained.
- A share is settled in the expense's own currency and never exceeds what is
  still open. The check runs under the expense and payment locks, so two
  concurrent shares cannot both pass it.
- A discount names its EXPENSE DEDUCTION financial category explicitly. It is
  recorded as an expense keyed `discount-<settlementId>`, settled negative
  into the same payment after the share.
- Voiding a share voids its discount first, because a payment is never
  negative.
- Position (settled, outstanding, status) is derived from active settlements
  on every read.

### Revenue cycle and transfers

| Operation | Access | HTTP | MCP tool |
|---|---|---|---|
| `finance.createRevenue` | write | `POST /revenues` | `create_revenue` |
| `finance.listRevenues` | read | `GET /revenues` | `list_revenues` |
| `finance.getRevenue` | read | `GET /revenues/:id` | `get_revenue` |
| `finance.createReceipt` | write | `POST /receipts` | `create_receipt` |
| `finance.listReceipts` | read | `GET /receipts` | `list_receipts` |
| `finance.getReceipt` | read | `GET /receipts/:id` | `get_receipt` |
| `finance.settleRevenue` | write | `POST /revenue-settlements` | `settle_revenue` |
| `finance.receiveRevenue` | write | `POST /revenues/:revenueId/receive` | `receive_revenue` |
| `finance.voidRevenueSettlement` | write, destructive | `POST /revenue-settlements/:id/void` | `void_revenue_settlement` |
| `finance.createTransfer` | write | `POST /transfers` | `create_transfer` |
| `finance.listTransfers` | read | `GET /transfers` | `list_transfers` |

- `createRevenue` records a revenue, positive, in a plain REVENUE financial
  category. A revenue states its amount; its settlements never exceed it
  (ADR 20).
- `receiveRevenue` opens a received receipt and settles the share in one
  write, the revenue side's `payExpense`.
- A transfer is one event between two accounts of the Book, positive, with a
  key the caller chooses. The two statement sightings of one transfer meet
  through their links' statement key (ADR 17).

### Account movements

| Operation | Access | HTTP | MCP tool |
|---|---|---|---|
| `finance.listMovementFiles` | read | `GET /movement-files` | `list_movement_files` |
| `finance.list{Payment,Receipt}Movements` | read | `GET /{payment,receipt}-movements` | `list_payment_movements`, `list_receipt_movements` |
| `finance.list{Payment,Receipt}MovementDescriptors` | read | `GET /{payment,receipt}-movement-descriptors` | `list_payment_movement_descriptors`, `list_receipt_movement_descriptors` |
| `finance.list{Payment,Receipt}MovementLinks` | read | `GET /{payment,receipt}-movement-links` | `list_payment_movement_links`, `list_receipt_movement_links` |
| `finance.classify{Payment,Receipt}MovementDescriptor` | write | `PATCH /{payment,receipt}-movement-descriptors` | `classify_payment_movement_descriptor`, `classify_receipt_movement_descriptor` |
| `finance.post{Payment,Receipt}Movement` | write | `POST /{payment,receipt}-movements/:id/post` | `post_payment_movement`, `post_receipt_movement` |
| `finance.ignore{Payment,Receipt}Movement` | write | `POST /{payment,receipt}-movements/:id/ignore` | `ignore_payment_movement`, `ignore_receipt_movement` |
| `finance.undo{Payment,Receipt}Movement` | write, destructive | `POST /{payment,receipt}-movements/:id/undo` | `undo_payment_movement`, `undo_receipt_movement` |

Each side's tools take only that side's fields: a payment movement posts
with `expenses`, a receipt movement with `revenues` or a `settlementGroup`,
and only a receipt movement can be a `promise`. A movement id of the other
side is not found.

- A descriptor is addressed by its side, `accountId` and `descriptorKey`,
  the normalized name. It holds a party and financial category, or a counter
  account, and the `paymentMethod`. Nothing is read from a line's wording
  (ADR 16).
- Only the descriptor maps a line: a matching `descriptor_key` gives it the
  descriptor's data; a new name gets an empty descriptor and waits. A line is
  eligible to post only when its other end and payment method are known. Eligible lines post at intake and when their descriptor
  is classified.
- `post_payment_movement` / `post_receipt_movement` can create the expense or revenue from a party and
  financial category, or settle existing ones: `expenses: [{expenseId,
  amount}]` or `revenues: [{revenueId, amount}]`, adding up to the line, one
  payment or receipt, one link each.
### Revenue movements

| Operation | Access | HTTP | MCP tool |
|---|---|---|---|
| `finance.listRevenueMovements` | read | `GET /revenue-movements` | `list_revenue_movements` |
| `finance.listRevenueMovementDescriptors` | read | `GET /revenue-movement-descriptors` | `list_revenue_movement_descriptors` |
| `finance.listRevenueMovementLinks` | read | `GET /revenue-movement-links` | `list_revenue_movement_links` |
| `finance.classifyRevenueMovementDescriptor` | write | `PATCH /revenue-movement-descriptors` | `classify_revenue_movement_descriptor` |
| `finance.postRevenueMovement` | write | `POST /revenue-movements/:id/post` | `post_revenue_movement` |
| `finance.ignoreRevenueMovement` | write | `POST /revenue-movements/:id/ignore` | `ignore_revenue_movement` |
| `finance.undoRevenueMovement` | write, destructive | `POST /revenue-movements/:id/undo` | `undo_revenue_movement` |

- A record (one payment method, one day, into the till) is up to three
  revenues: gross, discount (negative, DEDUCTION) and fee. Each has its own
  descriptor, `<method>_bruto`, `_desconto` or `_taxa` (ADR 19).
- Links carry `external_key` (the record) and `revenue_key` (each revenue,
  also its key). Every movement link names its group and its destination's
  key the same way.

### Card statements

| Operation | Access | HTTP | MCP tool |
|---|---|---|---|
| `finance.listCardMovements` | read | `GET /card-movements` | `list_card_movements` |
| `finance.listCardMovementDescriptors` | read | `GET /card-movement-descriptors` | `list_card_movement_descriptors` |
| `finance.listCardMovementLinks` | read | `GET /card-movement-links` | `list_card_movement_links` |
| `finance.classifyCardMovementDescriptor` | write | `PATCH /card-movement-descriptors` | `classify_card_movement_descriptor` |
| `finance.postCardMovement` | write | `POST /card-movements/:id/post` | `post_card_movement` |
| `finance.ignoreCardMovement` | write | `POST /card-movements/:id/ignore` | `ignore_card_movement` |
| `finance.undoCardMovement` | write, destructive | `POST /card-movements/:id/undo` | `undo_card_movement` |

- A purchase is one expense (`card-<expense key>`, instalment amount ×
  count) settled into one payment per instalment, `card-<account>-<YYYY-MM>`,
  unpaid, with the method of the purchase's descriptor, due on its billing window's `dueOn`. The first invoice is the billing window holding
  the purchase date; each next instalment one month later. No window, no post.
- The expense key has the instalment count; the payment key, the instalment
  `k/n`. A later invoice's line attaches to the instalment its payment key
  names. Only the descriptor decides: there is no choosing a record.
- A line's `statementId` is the sha256 of its text; its `externalId`, of the
  text without the current instalment: the purchase. A refund (credit with a
  DEDUCTION category) posts as a discount on its invoice's payment.
- The invoice paid is a transfer: the card descriptor names the account it
  is paid from (`counterAccountId`), and the line joins, by statement key, the
  transfer that account's statement outflow made (or makes it). Both sides
  look in `payment_movement_links` and `card_movement_transfers`.

- Every link carries the statement key `<from>-<METHOD>-<to>-YYYYMMDD-<amount>`
  (ends `a<account>` or `p<party>`). Posting a transfer joins the transfer of
  a link with the same key that has no link on this side yet; otherwise it
  creates the transfer.
- A receipt movement posted with a party joins the revenue and receipt of a
  receipt movement of the same account, from a content of another type,
  with the same statement key: an acquirer's deposit and its bank line meet
  in one receipt (ADR 20). A movement marked `promise` (the deposit report)
  posts the receipt expected, with no paid date; the bank line pays it.
  Undoing the bank line makes it expected again; undo keeps a receipt
  another sighting still links.
- A receipt movement whose descriptor names a party, a payment method and a
  `settlementGroup`, and no financial category, is money in for sales already
  recognized (ADR 20): one receipt and no revenue. It settles the group's open
  acquirer records (revenue movements whose `_taxa_adquirente` descriptor
  names the group), oldest first, whose nets add up to it: each record's gross
  into the point of sale's revenues of its day and `settlesMethodKey`, in
  their proportions, and its fee into its fee revenue. Otherwise it stays
  PENDING (`SALES_NOT_MATCHED` when posted by hand). When the group is
  named by point-of-sale gross descriptors instead (an operator with no
  report, vouchers), the deposit fills their open records oldest first, the
  last in part (ADR 20).
- A point-of-sale gross descriptor naming `receivedAccountId` (cash, the
  till) makes the record's own receipt there when it posts, settling its
  revenues (ADR 20). `revenue_movement_receipts` holds every collection; a
  record a deposit collected is not undone before that deposit.

Each write records `<resource>.created`, `.updated` or `.deleted` with the
fields sent as payload. A record of another Book, or an id that is not a
number, answers `UNAUTHORIZED_OR_NOT_FOUND`.

## Tables

| Table | Holds |
|---|---|
| `institutions` | A financial institution or platform; unique `key` per Book |
| `accounts` | Money the Book controls: `CARD`, `ACCOUNT`, `INVESTMENT` or `CASH`; one `number` per institution |
| `account_cycles` | A card's billing window per invoice, with the day it is due; windows of one account never overlap |
| `parties` | Who is on the other side of a record |
| `financial_categories` | The chart of accounts, two levels; `kind` EXPENSE or REVENUE; `role` FIXED, MERCHANDISE or DEDUCTION |
| `expenses`, `payments`, `expense_settlements` | The expense cycle |
| `revenues`, `receipts`, `revenue_settlements` | The revenue cycle |
| `transfers` | One event between two owned accounts |
| `movement_consumers` | Per account and `movement_type`, the importer id that reads its content |
| `movement_files` | The intake ledger: account, type, importer id, version and fingerprint, content sha256, source key, counts; unique per account, fingerprint and content |
| `payment_movements`, `receipt_movements` | A statement line that took money out or brought it in, unique per account and `external_id`; one id sequence for both; name, `descriptor_key`, optional `payment_method`, mapping; `status` PENDING, POSTED or IGNORED |
| `payment_movement_descriptors`, `receipt_movement_descriptors` | Keyed by account and `descriptor_key`: the party and financial category, or the counter account, and optionally the payment method its lines post with |
| `payment_movement_links`, `receipt_movement_links` | What a posted line became, with its searchable `statement_key`: a transfer, or an expense and payment (revenue and receipt) |
| `card_movements` | A card invoice line, unique per card by `statement_id` (the hash of the line); `external_id` is the purchase (the hash without the current instalment), with its expense and payment keys, instalment k of n and signed amount |
| `card_movement_descriptors` | Per card and `descriptor_key`: the party and EXPENSE financial category |
| `card_movement_expenses` | Per card and expense key: the purchase's expense |
| `card_movement_payments` | Per card and payment key: the instalment's invoice payment and settlement, and the line that showed it |
| `card_movement_transfers` | The transfer an invoice paid became, with its `external_key` and `statement_key` |
| `revenue_movements` | A day's sales by method, from the point of sale or the acquirer: gross (recognized here or not), discount, fee, acquirer fee, amount to receive |
| `revenue_movement_descriptors` | Per account and component descriptor key (`_bruto`, `_desconto`, `_taxa`, `_taxa_adquirente`): the party and REVENUE category |
| `revenue_movement_links` | One per revenue a record became: `external_key` (the record), `statement_id` (the item), component, `revenue_key` |
| `revenue_movement_receipts` | Which receipts collected a record: a deposit, an operator's deposits in part, or its own receipt (`own`, cash) (ADR 20) |

Every table carries `book_id` in its primary key and every reference
includes it, so no record can point into another Book.

## Invariants

Enforced by `src/db/triggers.sql`; each has a test in
`packages/testing/src/integration/finance-schema.integration.ts`.

- An expense settlement carries its expense's sign and never exceeds its
  magnitude; a payment is the signed sum of its active settlements and never
  negative.
- A receipt is the signed sum of its active settlements and never negative,
  so a deduction is settled after its positive item and voided before it.
- A revenue states its amount; its active settlements carry its sign and
  never exceed it (ADR 7); voiding
  the last leaves the amount it last had (an item is never zero).
- An item is negative exactly when its category or its group has the
  DEDUCTION role, and a role change cannot leave items with the wrong sign.
- Categories nest one level within one kind; a group holds no records.
- A movement is POSTED exactly when it has links, and they add up to its
  amount (checked at commit); only IGNORED has a reason. A link is a transfer
  or an entry with its cash record, never both; its payment leaves (its
  receipt lands in) the movement's account; a transfer link has the
  movement's amount and account on its side, and each side of a transfer has
  at most one link. A statement key is `<from>-<METHOD>-<to>-YYYYMMDD-<amount>`.
- A card line is POSTED exactly when an instalment link names it (checked
  at commit). An instalment link names a payment of its own card and a
  settlement of that payment into the purchase's expense, and only a line of
  the same purchase and instalment.
- A revenue movement is POSTED exactly when it links one revenue per
  component it carries, each of its component's amount; a gross the movement
  does not recognize is never linked.

## Testing

`@lastro/finance/testing` exports `memoryFinancePort()` and
`financeTestHost(extra)`: core and finance over memory inside the real
envelope. A dependent module passes its own definition in `extra` to unit-test
against finance's real use cases. Database rules are covered only by the
integration suite.
