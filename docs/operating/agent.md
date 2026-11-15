# Operating Lastro as an agent

This is the guide for the agent that keeps a Book over MCP. Each flow's own
document in [docs/flows/](../flows/README.md) is the reference; this page is
the run.

## Connecting

Each module has its own MCP endpoint, `/mcp/<module>`, with that module's
tools only. Connect to the ones you use, with the same credential:

| Endpoint | Tools |
|---|---|
| `/mcp/core` | `list_books`, `list_audit_events`, `revoke_agent_credential` |
| `/mcp/finance` | catalogs, the four records, transfers, and the review of every finance evidence family |
| `/mcp/finance-imports` | `import_movements`, `set_movement_consumer`, `list_movement_consumers`, `list_movement_importers` |
| `/mcp/sales` | products, sales days, the review of sale movements |
| `/mcp/sales-imports` | `import_sales`, `set_sale_consumer`, `list_sale_consumers`, `list_sale_importers` |
| `/mcp/close` | `get_daily_close`, `list_daily_closes` |

`GET /mcp` answers the list of endpoints. A tool sent to another module's
endpoint is unknown there.

## Ground rules

- **One credential, one Book.** `list_books` shows it. `bookId` is optional
  on every tool and, when sent, must be the credential's.
- **Every write takes an `idempotencyKey`.** For a file, derive it from the
  content: `<flow>-<sha256 of the text>`. Retrying with the same key answers
  the first result.
- **Destructive tools** (`undo_*`, `void_*`, `delete_*`, `revoke_agent_credential`) need
  `confirmation: "confirm"`. Use them to correct, after reading what a line
  became.
- **The descriptor decides.** A line is what its descriptor says: party and
  financial category, other account, payment method, product. Decide by the
  Book (`list_parties`, `list_financial_categories`, `list_products`, earlier
  posted lines) or ask the owner, and classify the descriptor once; every
  past and future line of that name follows.
- **Sending a file again is safe.** The same file answers
  `alreadyImported: true`; an overlapping one counts its known lines as
  `known`.

## Set up a Book once

1. `list_accounts`. Create what is missing with `create_account`: the bank
   accounts (`ACCOUNT`, with their numbers), each card (`CARD`), the till.
2. `list_parties` and `list_financial_categories`: the suppliers, the
   acquirer and the point of sale's operators, and the categories the owner
   uses. Create the rest with the owner.
3. Route every file type to its importer (`list_movement_importers` and
   `list_sale_importers` list them):

   | File | Call |
   |---|---|
   | Nubank account | `set_movement_consumer` (Nubank, `account-movements`, `nubank/account`) |
   | C6 account | `set_movement_consumer` (C6, `account-movements`, `c6/account`) |
   | Stone account | `set_movement_consumer` (Stone, `account-movements`, `stone/account`) |
   | Stone payouts | `set_movement_consumer` (the account paid, `receipt-movements`, `stone/payouts`) |
   | C6 card | `set_movement_consumer` (the card, `card-movements`, `c6/card`) |
   | Point of sale payments | `set_movement_consumer` (the till, `revenue-movements`, `yooga/payments`) |
   | Stone sales | `set_movement_consumer` (Stone, `revenue-movements`, `stone/sales`) |
   | Point of sale sales | `set_sale_consumer` (`sale-movements`, `yooga/sales`) |

   `list_movement_consumers` and `list_sale_consumers` show what is set.
4. For a card, `create_account_cycle` for each invoice window still being
   billed and the ones ahead.

## Send a file

Finance files:

```text
import_movements { accountId, type, key: <the file's path>, content,
                   idempotencyKey: "<flow>-<sha256>" }
→ { new, known, posted, pending, alreadyImported }
```

Sales files:

```text
import_sales { type: "sale-movements", key, content, idempotencyKey }
→ { new, known, posted, pending, alreadyImported }
```

`list_movement_files` and `list_sale_files` show what has been taken in. A
refusal (`IMPORT_FORMAT`, or `MOVEMENT_CONFLICT` for a known line that changed) wrote
nothing: report it to the owner with the row it names.

## When lines wait

`pending > 0` means some names have no decision yet. Find them, decide,
classify:

| Evidence | Find | Classify | One line |
|---|---|---|---|
| Money out of an account | `list_payment_movements` `status: "PENDING"` | `classify_payment_movement_descriptor` (party + EXPENSE category, or `counterAccountId`; `paymentMethod`) | `post_payment_movement` with `expenses`, `ignore_payment_movement` |
| Money into an account | `list_receipt_movements` `status: "PENDING"` | `classify_receipt_movement_descriptor` (party + REVENUE category, or `counterAccountId`, or party + `settlementGroup` for acquirer deposits; `paymentMethod`) | `post_receipt_movement` with `revenues`, `ignore_receipt_movement` |
| Card | `list_card_movements` `status: "PENDING"` | `classify_card_movement_descriptor` (party + category; `counterAccountId` for the invoice payment) | `post_card_movement` after creating a missing cycle, `ignore_card_movement` |
| Revenue | `list_revenue_movement_descriptors` `classified: "false"` | `classify_revenue_movement_descriptor` (party + category; for acquirer fees also `settlementGroup` and `settlesMethodKey`) | `post_revenue_movement`, `ignore_revenue_movement` |
| Sales | `list_sale_movement_descriptors` `classified: "false"` | `classify_sale_movement_descriptor` (the product; create it first) | `post_sale_movement`, `ignore_sale_movement` |

A classified descriptor posts its waiting lines at once. Ask the owner
whenever the Book does not already say what a name is; never decide it from
the wording.

## Flow by flow

- **Bank accounts** (`nubank-account`, `c6-account`, `stone-account`): a
  descriptor naming another of the Book's accounts makes a transfer; both
  statements meet in it by statement key. Acquirer deposits on the bank
  statement take the acquirer as party, the method and the
  `settlementGroup` of their mode and brand, and no category.
- **Stone payouts**: imported as expected receipts on the account they pay;
  the bank line with the same statement key makes them received.
- **C6 card**: each purchase becomes an expense per instalment, billed in
  the cycle its date falls in. The invoice payment on the C6 statement is a
  transfer to the card.
- **Point of sale payments** (`yooga-payments`): the day's revenue per
  method, with discounts and tips. Cash and Pix settle on their own evidence
  (the till, the Stone account's Pix day).
- **Stone sales**: the acquirer's fee per sale, grouped with the deposits
  that pay it.
- **Point of sale sales** (`yooga-sales`): the day's lines by product, with
  their cost; they record what sold and recognize no revenue.

## Checking and correcting

- `list_payment_movement_links`, `list_receipt_movement_links`,
  `list_card_movement_links`, `list_revenue_movement_links`,
  `list_sale_movement_links`: what a line became, by statement key, external
  key or record. A transfer has a link on each side.
- `undo_<family>_movement` (`confirmation: "confirm"`) sends a line back to
  pending; the expense or revenue it created stays and is reused.
- `get_daily_close` and `list_sales_days`: a day's sales, cost, share of
  fixed expenses and result; `missingCost` names products without a cost.
- `list_audit_events`: what was written, by whom, for whom.
