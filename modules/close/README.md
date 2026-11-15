# close

**Owns:** the daily close. No tables: every close is derived on read.

**Depends on:** `kernel`, `core`, `finance`, `sales`

Finance and sales do not know each other (ADR 11). A view that needs both
lives here and reads them through their public interfaces:
`sales.days.list` for what a day sold and cost, and
`finance.expenses.totalByRole` for the month's fixed expenses. Leaving this
module out of the host removes the close and nothing else.

## Public interface

None. Other modules do not depend on it.

## Operations

| Resource | Operation ids | HTTP (under the Book) | MCP tools |
|---|---|---|---|
| Daily close | `close.getDailyClose`, `close.listDailyCloses` | `GET /daily-closes/:businessDate`, `GET /daily-closes` | `get_daily_close`, `list_daily_closes` |

## The daily close

Derived on every read, never stored (ADR 21):

- `sold` and `cost` from the day's sale lines; `missingCost` names the
  products without one.
- `fixedShare`: the month's FIXED expenses divided among the month's posted
  days, the remainder's cents to the earliest. An open month with no fixed
  expenses yet borrows the previous month's.
- `result`: `sold − cost − fixedShare`.
- `provisional` while the month is open.

A day with no posted sale line answers `SALES_DAY_NOT_POSTED` (404).

## Tests

- `src/domain/close.test.ts`: the fixed-cost share.
- `packages/testing/src/integration/sales-close.integration.ts`: the close
  on PostgreSQL, through the host.
- `closeTestHost` in `src/testing.ts`: core, finance, sales and close over
  memory, for any test that needs the whole ledger.
