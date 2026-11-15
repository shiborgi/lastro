"""Generate the physical data dictionary from the committed Drizzle snapshot.

Run: python3 docs/diagrams/generate-schema-docs.py
Does not connect to a database or change migrations.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / "packages/host/drizzle/meta/0000_snapshot.json"
MODULES = ROOT / "packages/host/src/modules.ts"
OUTPUT = ROOT / "docs/data-dictionary.md"

# Modules in the host's order; each owns the tables its schema.ts declares (ADR 11).
def module_order():
    source = MODULES.read_text()
    listed = re.search(r"manifests[^=]*=\s*\[([^\]]*)\]", source, re.S).group(1)
    names = [name.strip().removesuffix("Module") for name in listed.split(",") if name.strip()]
    # financeImportsModule lives in modules/finance-imports.
    return [re.sub(r"(?<!^)([A-Z])", lambda m: "-" + m.group(1).lower(), name) for name in names]


def owned_tables(module):
    path = ROOT / "modules" / module / "src/db/schema.ts"
    if not path.exists():
        return []  # an import module owns no tables (ADR 13)
    schema = path.read_text()
    return re.findall(r'[A-Za-z]*Table\(\s*"([a-z_]+)"', schema)


NOTES = {
    "auth_users": "Better Auth identity (model `user`). A delegate created by `bootstrap --delegate` has no `auth_accounts` row and cannot sign in.",
    "auth_accounts": "Better Auth sign-in method (model `account`); financial accounts are `accounts` in finance.",
    "books": "The tenancy root. Every business record carries `book_id` in its primary key and every reference.",
    "book_members": "The role a user holds in a Book. The write envelope reads it on every operation; a context's claimed role is ignored.",
    "agent_credentials": "A principal acting for one member of one Book. The composite key to `book_members` makes the agent's role its operator's, resolved per request.",
    "audit_events": "Append-only; written only by core's write envelope and `admin.issueAgentCredential`. `operation` names the operation that ran.",
    "idempotency_records": "One key per Book: the operation it was used for and the wire result answered, which a replay returns without running anything.",
    "accounts": "Only money the Book controls (ADR 8). A party that owes money is never an account.",
    "account_cycles": "A card's billing window per invoice, with `due_on`, the day the invoice is due; windows of one account never overlap.",
    "parties": "Who is on the other side of a record.",
    "financial_categories": "The chart of accounts, two levels. `role` FIXED or MERCHANDISE classifies expenses for result reports; DEDUCTION makes a category's items negative (ADR 6).",
    "expenses": "What the Book owes. Negative only as a discount obtained, keyed `discount-<settlementId>`.",
    "payments": "`amount` is the signed sum of active settlements, kept by a trigger, never negative.",
    "revenues": "What the Book earned. States its amount, as an expense does: its active settlements carry its sign and never exceed it (ADR 7).",
    "receipts": "`amount` is the signed sum of active settlements. Expected while `paid_on` is null (a promise, ADR 20), received once paid.",
    "movement_consumers": "Which importer reads one account's content of one type (ADR 14). `importer_id` is opaque to finance; finance-imports checks it.",
    "movement_files": "The intake ledger. The same content read by the same importer into the same account is one intake; `source_key` is provenance only.",
    "payment_movements": "An account line that took money out. POSTED exactly when it has links adding up to its amount (deferred trigger).",
    "receipt_movements": "A line that brought money in, or an acquirer's promise of it (`promise`, ADR 20); shares the id sequence with `payment_movements`. With a `settlement_group` it settles sales already recognized (ADR 20).",
    "payment_movement_links": "What a posted payment movement became: a transfer, or an expense with the payment that settled it. `statement_key` is `<from>-<METHOD>-<to>-YYYYMMDD-<amount>` and is how the other side of a transfer finds it.",
    "receipt_movement_links": "What a posted receipt movement became: a transfer, a revenue with the receipt that settled it, or a receipt of sales alone (ADR 7). A deposit's promise and its bank line share one receipt by `statement_key`.",
    "card_movements": "A card invoice line (ADR 18). `external_id` is the sha256 of the line's text, `payment_key` the instalment (k/n), `expense_key` the purchase. POSTED exactly when an instalment link names it (deferred trigger).",
    "card_movement_descriptors": "Per card and `descriptor_key`: the party and EXPENSE financial category its purchases post with.",
    "card_movement_expenses": "The expense of a purchase, by expense key.",
    "card_movement_payments": "One instalment of a purchase: its invoice payment (`card-<account>-<YYYY-MM>`) and settlement, and the line that showed it, null until seen.",
    "card_movement_transfers": "The transfer an invoice paid became: from the account it was paid from into the card, with its `statement_key`. The account statement's outflow finds it by that key.",
    "revenue_movements": "A day's sales by method (ADR 19). `amount` = `gross` − `discount` + `fee` − `acquirer_fee`; an acquirer's gross is not recognized again (`gross_recognized`). POSTED exactly when it links one revenue per component it carries (deferred trigger).",
    "revenue_movement_descriptors": "Per account and `descriptor_key` (`<method>_bruto`, `_desconto`, `_taxa`, `_taxa_adquirente`): the party and REVENUE category; an acquirer's fee also names its deposit `settlement_group` and the method its gross settles (ADR 20).",
    "revenue_movement_links": "One revenue a record became: `external_key` is the record's group, `revenue_key` the revenue and its own key.",
    "revenue_movement_receipts": "Which receipts collected a record: an acquirer's deposit, an operator's deposits in part, or the record's own receipt (`own`, cash in the till) (ADR 20).",
    "sale_movements": "One product of one day as the point of sale printed it (ADR 21). POSTED exactly when it has its link (deferred trigger).",
    "sale_movement_links": "The sale line a posted movement became: `external_key` and `sale_key` = `<external_key>-sale`.",
    "sales": "One product's line of a day. `cost` is NULL exactly when `cost_source` is MISSING; every line has its movement link.",
}


def code(value):
    if isinstance(value, bool):
        value = "true" if value else "false"
    elif value is None:
        value = "NULL"
    return "`" + str(value).replace("`", "&#96;").replace("|", "\\|").replace("\n", " ") + "`"


def names(columns):
    return ", ".join(code(c) for c in columns)


def generate():
    snapshot = json.loads(SNAPSHOT.read_text())
    tables = {t["name"]: t for t in snapshot["tables"].values()}
    modules = module_order()
    groups = {module: owned_tables(module) for module in modules}
    grouped = [name for names_ in groups.values() for name in names_]
    if len(grouped) != len(set(grouped)) or set(grouped) != set(tables):
        raise ValueError(f"A table belongs to no module, or to two: {set(tables) ^ set(grouped)}")
    out = [
        "# Physical data dictionary", "",
        "Generated by `python3 docs/diagrams/generate-schema-docs.py`. Do not edit manually.", "",
        "Sources: the [Drizzle snapshot](../packages/host/drizzle/meta/0000_snapshot.json), the "
        "[init SQL](../packages/host/drizzle/0000_init.sql) and each module's `src/db/triggers.sql`. "
        "Tables are grouped by the module that owns them, in the host's module order. "
        "Rules and meaning are in each module's README and the [model map](data-model.md).", "",
        f"Inventory: **{len(tables)} tables** and **{sum(len(t['columns']) for t in tables.values())} declared columns** in "
        f"**{len(modules)} modules**. `schema_migrations` is created by the initializer and described below.", "",
        "Fields use physical PostgreSQL names. “Nullable?” accounts for primary keys as well as `NOT NULL`. "
        "Foreign keys below represent only declared constraints.", "",
    ]
    for module, group_tables in groups.items():
        out.extend([f"## {module}", "", f"Owned by [`modules/{module}`](../modules/{module}/README.md).", ""])
        for name in group_tables:
            t = tables[name]
            primary = [c["name"] for c in t["columns"].values() if c.get("primaryKey")]
            for pk in t["compositePrimaryKeys"].values():
                primary.extend(pk["columns"])
            out.extend([f"### {name}", ""])
            if name in NOTES:
                out.extend([NOTES[name], ""])
            out.extend([f"**Primary key:** {names(primary)}.", "", "| Column | PostgreSQL type | Nullable? | Default |", "|---|---|---|---|"])
            for c in t["columns"].values():
                nullable = not (c.get("notNull") or c["name"] in primary)
                default = c.get("default", "sequence (serial)" if c["type"] in ("serial", "bigserial") else "—")
                out.append(f"| {code(c['name'])} | {code(c['type'])} | {'Yes' if nullable else 'No'} | {code(default)} |")
            out.append("")
            if t["foreignKeys"]:
                out.extend(["**Foreign keys**", "", "| Constraint | Source | Target | On delete / update |", "|---|---|---|---|"])
                for fk in t["foreignKeys"].values():
                    out.append(f"| {code(fk['name'])} | {names(fk['columnsFrom'])} | {code(fk['tableTo'])} ({names(fk['columnsTo'])}) | {code(fk['onDelete'])} / {code(fk['onUpdate'])} |")
                out.append("")
            if t["indexes"] or t["uniqueConstraints"]:
                out.extend(["**Indexes and uniqueness**", "", "| Name | Type | Columns / expression | Predicate |", "|---|---|---|---|"])
                for idx in t["indexes"].values():
                    expressions = [c["expression"] for c in idx["columns"]]
                    out.append(f"| {code(idx['name'])} | {'UNIQUE' if idx['isUnique'] else idx['method']} | {names(expressions)} | {code(idx.get('where', '—'))} |")
                for uq in t["uniqueConstraints"].values():
                    out.append(f"| {code(uq['name'])} | UNIQUE constraint | {names(uq['columns'])} | — |")
                out.append("")
            if t["checkConstraints"]:
                out.extend(["**CHECKs**", "", "| Name | Expression |", "|---|---|"])
                for chk in t["checkConstraints"].values():
                    out.append(f"| {code(chk['name'])} | {code(chk['value'])} |")
                out.append("")
    triggers = []
    for module in modules:
        path = ROOT / "modules" / module / "src/db/triggers.sql"
        if not path.exists():
            continue
        found = re.findall(r"CREATE(?: CONSTRAINT)? TRIGGER (\w+)\s+(.+?)\s+ON (\w+)\s+(DEFERRABLE INITIALLY DEFERRED\s+)?FOR EACH ROW EXECUTE FUNCTION (\w+)\((.*?)\);", path.read_text(), re.S)
        triggers.extend((module, *each) for each in found)
    out.extend(["## Triggers", "", "Extracted from each module's `src/db/triggers.sql`. Helper functions and rule bodies remain in the SQL files. A trigger belongs to the module whose rule it holds, which is not always the module that owns its table.", "", "| Module | Trigger | Table | Event | Deferred? | Function |", "|---|---|---|---|---|---|"])
    for module, trigger, event, table, deferred, function, arguments in triggers:
        out.append(f"| {code(module)} | {code(trigger)} | {code(table)} | {code(' '.join(event.split()))} | {'Yes' if deferred else 'No'} | {code(function + '(' + arguments + ')')} |")
    out.extend(["", "All triggers are row-level; the deferred ones run at commit.", "", "## schema_migrations", "", "Created by [initialize.ts](../packages/host/src/initialize.ts), outside the Drizzle snapshot.", "", "| Column | Type | Rule |", "|---|---|---|", "| `filename` | `text` | Primary key; applied file name |", "| `applied_at` | `timestamptz` | NOT NULL, default `now()` |", "", "Tracking uses file names. Regenerating `0000_init.sql` does not update an installation that already applied it; see the [runbook](runbook.md) for recreating the database.", ""])
    OUTPUT.write_text("\n".join(out))
    print(f"Generated {OUTPUT.relative_to(ROOT)}: {len(tables)} tables, {len(triggers)} triggers")


if __name__ == "__main__":
    generate()
