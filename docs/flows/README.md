# Import flows

Each flow is one source file read by one parser, staged as movements by the
receiving module and posted only by its descriptors (ADRs 13–16). A flow's
document is the contract: change the flow and its document in the same
commit. Start a new one from [TEMPLATE.md](TEMPLATE.md) and
[adding-an-import-flow.md](../extending/adding-an-import-flow.md).

| Flow | Importer | Type | Tool | Stages into | Posts as |
|---|---|---|---|---|---|
| [nubank-account](nubank-account.md) | `nubank/account` | `account-movements` | `import_movements` | `payment_movements`, `receipt_movements` | expenses and payments, revenues and receipts, transfers |
| [c6-account](c6-account.md) | `c6/account` | `account-movements` | `import_movements` | the same | the same; receipts of sales by settlement group |
| [stone-account](stone-account.md) | `stone/account` | `account-movements` | `import_movements` | the same | Pix sent; the day's Pix sales as one receipt |
| [stone-payouts](stone-payouts.md) | `stone/payouts` | `receipt-movements` | `import_movements` | `receipt_movements` (promises) | expected receipts, paid by the bank line |
| [c6-card](c6-card.md) | `c6/card` | `card-movements` | `import_movements` | `card_movements` | one expense per purchase, its instalments, the invoice transfer |
| [yooga-payments](yooga-payments.md) | `yooga/payments` | `revenue-movements` | `import_movements` | `revenue_movements` | gross, discount and tip revenues; cash received in the till |
| [stone-sales](stone-sales.md) | `stone/sales` | `revenue-movements` | `import_movements` | `revenue_movements` | the acquirer's fee |
| [yooga-sales](yooga-sales.md) | `yooga/sales` | `sale-movements` | `import_sales` | `sale_movements` | the day's sale lines |

## How the flows meet

```text
point of sale ── yooga-payments ──▶ revenues: gross − discount + tip
acquirer      ── stone-sales    ──▶ revenues: − acquirer fee
                                         ▲ settled by
deposits      ── stone-payouts  ──▶ expected receipt ◀── c6-account line pays it
Pix           ── stone-account  ──▶ the day's receipt in the acquirer account
cash          ── yooga-payments ──▶ the record's own receipt in the till
vouchers      ── c6-account     ──▶ the operator's deposit, oldest sales first
products      ── yooga-sales    ──▶ sale lines for the daily close
```

The providers are examples. A flow for another bank, card, point of sale or
acquirer is a new parser writing the same observations.
