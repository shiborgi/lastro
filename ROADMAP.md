# Roadmap

Open work, in the order it is expected. Each item names the flows or modules
it touches; a change to a flow updates its document in `docs/flows/`.

## Cross-source checks

Each check is an operation with a test and a screen, in the import module
that holds both sides, described in the flow documents it spans.

- The day's sales by product against the payments report's gross
  (`yooga-sales` × `yooga-payments`).
- The acquirer's gross against the point of sale's paid amount per method and
  day (`stone-sales` × `yooga-payments`).
- Payouts against the bank's lines (`stone-payouts` × `c6-account`).
- Pix credited to the acquirer account against its Pix sales
  (`stone-account` × `stone-sales`).
- What is still to be received: expected receipts and open revenue.

## Known gaps

- **Voucher operators' fee.** What an operator keeps stays open on the
  voucher sales; it should be recognized as a deduction once the operator's
  terms are known.
- **Credit in instalments.** An acquirer's sale in instalments is summed on
  the sale day; its repayment comes one instalment a month.
- **A day in progress.** An acquirer account export that includes the
  current day is refused when exported again with more sales of that day.
- **Re-trying deposits.** A deposit imported before the sales it settles
  waits; it is not retried when those sales arrive.
- **Equal deposits of two groups.** The statement key names party, method,
  account, day and amount, not the settlement group. Two deposits of the
  same method and amount on one day, of different brands, can pair across
  groups; the receipt then settles the promise's group.

## Operating

- A guided first run: consumers, descriptors and settlement groups set from
  one screen.
- Member management beyond `bootstrap`.
- Recurring jobs and a cash-flow summary.
