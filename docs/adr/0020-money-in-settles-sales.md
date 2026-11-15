# ADR 20: Money In Settles the Day's Sales

**Status:** Accepted (0.1.0)

## Context

Revenue comes from the sales; the money arrives later, by other routes, and must pay those revenues rather than create new ones.

## Decision

- A receipt movement whose descriptor names a party, a payment method and a `settlement_group`, and no category, posts one receipt and no revenue.
- Acquirer deposits: each acquirer record's fee descriptor names its group and the point-of-sale method its gross settles. A deposit takes its group's open records, oldest first, whose nets add up to it exactly, and settles each record's gross into the point of sale's revenues of that day and method in proportion, and its fee into the fee revenue. Otherwise it waits (`SALES_NOT_MATCHED`).
- Promise and confirmation: an acquirer's payout report is a promise (`promise`), posted as an expected receipt; the bank line with the same statement key joins that receipt and pays it. A bank line posted first is received at once and the promise joins it.
- Pix credited to the acquirer account is summed per day into one receipt movement that settles the day's Pix. Cash is the point of sale record's own receipt in the till (`received_account_id`). Voucher operators, which send no report, settle their group's open sales oldest first, the last in part; what they keep stays open.
- `revenue_movement_receipts` records which receipts collected each record; a record a deposit collected is not undone before that deposit.

## Consequences

- Every sale is seen once as revenue and once as cash; what is still to be received is visible as open revenue.
