# Flow: `yooga-sales`

The point of sale's sales report by product. Each line is one product sold
on one operational day, and posts as a sale line of that day, as the product
its code's descriptor names.

**Status:** Implemented (0.1.0). The file populates sale movements; a sale
descriptor names the product; posting writes the line in `sales` through a
link; no revenue is recognized, since it comes from `yooga-payments`
(ADR 21).
**Import module:** `sales-imports`
**Importer id and version:** `yooga/sales`, version `1`
**Receiving module:** `sales`

Decisions: ADRs 13, 14, 15, 16 and 21. The file is written by the agent from
the point of sale's sales report (read only).

## 1. Purpose

Record what the business sold each day, product by product, with its quantity,
what it sold for and what it cost, for the daily close. Each product code is
mapped once to a product of the Book, and every later day posts on its own.

## 2. Source system and how the file is obtained

- Yooga's sales report for the operational day D ([06:00 of D, 06:00 of D+1)
  America/Sao_Paulo), written by the agent as `vendas-AAAAMMDD-periodo.csv`.
- The agent calls `import_sales` with:
  - `type: "sale-movements"`;
  - the file's path as `key`;
  - the text as `content`.
- Set once: `set_sale_consumer` (`sale-movements`, `yooga/sales`).

## 3. File format and a redacted sample

- Comma-delimited with quoting, dot decimals, one header row.
- One row per product sold.

| Column | Meaning |
|---|---|
| `codigo` | Yooga's product code |
| `produto` | The product as printed |
| `categoria` | Yooga's grouping, as printed (provenance only) |
| `quantidade` | How many were sold |
| `custo` | The line's total cost, as Yooga reports it |
| `faturamento` | What the product sold for |
| `lucro_bruto`, `margem_pct` | Derived by Yooga; not read |
| `data_inicio`, `data_fim` | `YYYY-MM-DD 06:00` of D and of D+1 |

```text
codigo,produto,categoria,quantidade,custo,faturamento,lucro_bruto,margem_pct,data_inicio,data_fim
10931990,Cerveja Original Garrafa 600ml,Cerveja,86,679.40,1625.40,946.00,58.20,2026-11-01 06:00,2026-11-02 06:00
2714403,"Voucher 20,00",Couvert Artístico,34,0.00,680.00,680.00,100.00,2026-11-01 06:00,2026-11-02 06:00
```

On a real day, the products' `faturamento` sums to that day's payments
report `bruto`.

The files without `data_inicio` and `data_fim` (`vendas-AAAAMMDD.csv`) are
refused.

## 4. File identity and replay behaviour

- **File:** `sale_files`, by importer fingerprint and content sha256. The
  same content again answers `alreadyImported: true`.
- **Line:** no source id, so `external_id` is the sha256 of the line, `#n`
  for the n-th identical line. A line already staged is `known`; the same id
  on another day is refused.
- **Descriptor:** `descriptor_key` is the normalized `codigo` (the normalized
  `produto` when there is none).

## 5. Observations the parser returns

`SaleObservation`, one per row:
- `line` (the row's text), `occurredOn` (D);
- `code`, `name` and `providerCategory` (the point of sale's own category) as printed;
- `quantity` (exact decimal text), `revenue` and `cost` in minor units;
- `currency` `BRL`.

Refusals (`IMPORT_FORMAT`): another header, a missing period, a period that is
not one operational day, an unreadable amount, a quantity that is not
positive, no rows.

## 6. Receiving module and evidence family

| Table | Holds |
|---|---|
| `sale_consumers` | Per Book and type, the importer that reads it |
| `sale_files` | The intake ledger |
| `sale_movement_descriptors` | Per Book and `descriptor_key`: the name first seen and the product |
| `sale_movements` | One per line: day, code, name, category, quantity, revenue, reported cost, status |
| `sale_movement_links` | Per posted movement: `external_key` (the line's hash), `sale_key` (`<external_key>-sale`), the sale line |
| `sales` | The line a posted movement became |

## 7. Review states and who resolves them

| State | Meaning | Leaves by |
|---|---|---|
| `PENDING` | Its descriptor names no product yet | `classify_sale_movement_descriptor`, `ignore_sale_movement` |
| `POSTED` | It has its link to one sale line (deferred trigger) | `undo_sale_movement` |
| `IGNORED` | Not a sale, with a reason | `undo_sale_movement` |

## 8. What posting creates

One `sales` line: the movement's day, quantity, revenue and currency; the
descriptor's product; the cost of the product's `costOverride` (CATALOG),
else the reported `custo` (SALE), else none (MISSING). Its link carries
`external_key` and `sale_key` = `<external_key>-sale`. Undo deletes the link
and the line.
Nothing is written in finance.

## 9. Cross-source checks

- The day's `faturamento` should equal the day's `bruto` in `yooga-payments`.
  Not checked in version 1 (P6.8).

## 10. MCP tools an agent calls, in order

1. Once: `set_sale_consumer` (`sale-movements`, `yooga/sales`).
2. Daily, after the file is written: `import_sales`.
3. When `pending` > 0: `list_sale_movement_descriptors` with `classified: "false"`,
   then `classify_sale_movement_descriptor` with the product. Create the product first
   when the Book has none; ask the Book's owner which product a code is.
4. `list_sale_movement_links` by `externalKey` or `saleKey` finds what a
   line became. `ignore_sale_movement` for a line that is not a sale;
   `undo_sale_movement` corrects one.

## 11. Web screen

Vendas → Importações → **Vendas importadas**: the movements filtered by state (pending by
default): day, code, product, quantity, revenue, cost, state. A pending one
offers *Classificar* (the product, for every day of that code), *Lançar* and
*Ignorar*; a posted or ignored one *Desfazer*. *Importar vendas* uploads a
report. Vendas → Resultado → **Dias de venda** lists the days with lines.

## 12. Fixtures

`modules/sales-imports/src/parsers/yooga-sales/fixtures`:

| File | Proves |
|---|---|
| `day.csv` | Three products, a quoted name with a comma, one operational day |
| `without-period.csv` | The format without `data_inicio`/`data_fim`: refused |
| `two-days.csv` | A period of two days: refused |

Covered by:
- `yooga-sales/index.test.ts`;
- `sales-imports/src/application/yooga-sales.test.ts`;
- `packages/testing/src/integration/sales-days.integration.ts`.

## 13. Open questions

1. **The file without its period.** A report written without `data_inicio`
   and `data_fim` is refused; the agent's task writes the `-periodo` format
   every day.
