# Lastro data model

A map of the model, module by module. Each module's README is the reference for
its rules; this page shows where each concept lives and the flows that cross
modules. Names are defined in the [domain dictionary](domain-dictionary.md);
every table, column, key and trigger is in the generated
[physical dictionary](data-dictionary.md); the
[diagrams](diagrams/lastro-data-model.html) draw the main relationships.

## Where each concept lives

| Concept | Module | Tables | Reference |
|---|---|---|---|
| Users, sessions, Books, membership | core | `auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications`, `books`, `book_members` | [core](../modules/core/README.md) |
| Agent credentials | core | `agent_credentials` | [core](../modules/core/README.md) |
| Audit trail, idempotency | core | `audit_events`, `idempotency_records` | [core](../modules/core/README.md#the-write-envelope) |
| Institutions, accounts, billing windows | finance | `institutions`, `accounts`, `account_cycles` | [finance](../modules/finance/README.md) |
| Parties | finance | `parties` | [finance](../modules/finance/README.md) |
| Financial categories | finance | `financial_categories` | [finance](../modules/finance/README.md) |
| Expense cycle | finance | `expenses`, `payments`, `expense_settlements` | [finance](../modules/finance/README.md#expense-cycle) |
| Revenue cycle, transfers | finance | `revenues`, `receipts`, `revenue_settlements`, `transfers` | [finance](../modules/finance/README.md#revenue-cycle-and-transfers) |
| Imported evidence | finance | `movement_files`, `*_movements`, `*_descriptors`, `*_links` | [finance](../modules/finance/README.md#account-movements) |
| Products | sales | `product_categories`, `products` | [sales](../modules/sales/README.md) |
| Sales evidence, lines and days | sales | `sale_consumers`, `sale_files`, `sale_movement_descriptors`, `sale_movements`, `sale_movement_links`, `sales` (a day is derived from its lines) | [sales](../modules/sales/README.md#sales-evidence-adr-21) |
| Daily close | close | derived, never stored | [close](../modules/close/README.md#the-daily-close) |

Every table carries `book_id` in its primary key and every reference, so no
record can point into another Book. A module's tables reference only its own
and its dependencies'. `finance` and `sales` each reference only `core`'s
`books`, never each other.

## Money and signs

Amounts are `bigint` minor units. An item (expense or revenue) is negative
exactly when its financial category, or that category's group, has the
`DEDUCTION` role: a fee on a revenue, a discount on an expense. A settlement
carries its item's sign. A payment or receipt is the signed sum of its active
settlements and is never negative, so the positive share is written before its
deduction and a deduction is voided before the share it reduces.

A revenue states its amount, as an expense does; what its settlements have
not covered yet is still to be received (ADR 20). There are no receivables
(ADR 7).

Example: a payment of 950 for an expense of 1,000 with a discount of 50 is
two settlements in one payment, +1,000 against the expense and −50 against a
discount expense in an EXPENSE `DEDUCTION` financial category.

## From a sale to revenue

```text
yooga/payments (a day by payment method)
  └─ revenue_movements → revenues: gross, − discount, + tip
stone/sales (a day by product and brand)
  └─ revenue_movements → revenues: − acquirer fee (its gross is Yooga's)
yooga/sales (a day by product)
  └─ sale_movements → sale_movement_links → sales (lines, each with its product and cost); no revenue
```

The day's revenues add up to what will be received. Stone's deposit (the
promise) and its C6 line (the money) are one receipt that settles them, by
the group each `stone-sales` record names (ADR 20).

## Writes, concurrency and audit

Every operation runs inside core's write envelope: the role from Book
membership, one transaction, idempotent replay of a key, the audit events,
commit. A call from one module into another runs on that same transaction.
Settlement writers take advisory locks on the item and the payment or
receipt.

## File imports

Bank and card statements, acquirer exports and point-of-sale reports are read
by `finance-imports` and staged by finance (ADR 13). Each flow is documented
in `docs/flows/<flow-id>.md`.
