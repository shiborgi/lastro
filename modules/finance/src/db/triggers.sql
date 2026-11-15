-- finance: invariants a CHECK cannot express.
--
-- Appended to the generated init after the tables of every module (ADR 11).
-- drizzle-kit emits tables, indexes and constraints, never triggers or
-- plpgsql, so everything here is hand-written and separated by statement
-- breakpoints. `packages/host/src/initialize.test.ts` fails if a function or
-- trigger declared here stops reaching the init.
--
-- Every refusal raises ERRCODE 23514 (check_violation) with a message written
-- for whoever hit it: both surfaces hand those words to the caller unchanged.

-- Hand-written: drizzle-kit generates tables and constraints, not triggers.
--
-- "Active settlements may not exceed their expense's total" cannot be a CHECK,
-- because a CHECK cannot sum sibling rows. Without this the rule lived only in
-- application code, so any caller reaching the repository directly — or two
-- callers racing for the same remaining balance — could over-allocate an
-- expense. The repository already takes an advisory lock per expense and per
-- payment before inserting, which serialises the racers; this trigger is what
-- actually rejects the loser.
--
-- ERRCODE 23514 (check_violation) is raised deliberately: to a caller this is
-- the same class of failure as any other violated invariant.
--
-- Signed (ADR 6): a discount is a negative expense, so a settlement carries
-- its expense's sign and the cap is on magnitudes — a −50 discount is settled
-- by at most −50, never by +50 nor by −60.

CREATE OR REPLACE FUNCTION expense_settlement_within_total() RETURNS trigger AS $$
DECLARE
  expense_total bigint;
  allocated bigint;
BEGIN
  IF NEW.voided_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT amount INTO expense_total
    FROM expenses
   WHERE book_id = NEW.book_id AND id = NEW.expense_id;

  IF expense_total IS NULL THEN
    RETURN NEW; -- the foreign key rejects this row on its own
  END IF;

  IF sign(NEW.amount) <> sign(expense_total) THEN
    RAISE EXCEPTION
      'an expense settlement of % does not carry the sign of its expense %',
      NEW.amount, expense_total
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO allocated
    FROM expense_settlements
   WHERE book_id = NEW.book_id
     AND expense_id = NEW.expense_id
     AND voided_at IS NULL
     AND id IS DISTINCT FROM NEW.id;

  IF abs(allocated + NEW.amount) > abs(expense_total) THEN
    RAISE EXCEPTION
      'expense settlements (% + %) exceed expense total %',
      allocated, NEW.amount, expense_total
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS expense_settlement_within_total_trigger ON expense_settlements;
--> statement-breakpoint
CREATE TRIGGER expense_settlement_within_total_trigger
  BEFORE INSERT OR UPDATE ON expense_settlements
  FOR EACH ROW EXECUTE FUNCTION expense_settlement_within_total();
--> statement-breakpoint
-- `payments.amount` is documented in the schema as a cache of the active
-- settlements that the payment groups, never supplied by the caller. Nothing
-- maintained it, so every payment stayed at 0 and cash-flow outflows always
-- reported zero. This keeps it in step with the settlements. The sum is
-- signed: a payment of a bill and its discount is what actually left.
CREATE OR REPLACE FUNCTION refresh_payment_amount() RETURNS trigger AS $$
DECLARE
  target_book integer;
  target_payment integer;
BEGIN
  target_book := COALESCE(NEW.book_id, OLD.book_id);
  target_payment := COALESCE(NEW.payment_id, OLD.payment_id);

  UPDATE payments
     SET amount = COALESCE((
           SELECT SUM(amount)
             FROM expense_settlements
            WHERE book_id = target_book
              AND payment_id = target_payment
              AND voided_at IS NULL
         ), 0)
   WHERE book_id = target_book AND id = target_payment;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS refresh_payment_amount_trigger ON expense_settlements;
--> statement-breakpoint
CREATE TRIGGER refresh_payment_amount_trigger
  AFTER INSERT OR UPDATE OR DELETE ON expense_settlements
  FOR EACH ROW EXECUTE FUNCTION refresh_payment_amount();
--> statement-breakpoint
-- The receipt's mirror of `refresh_payment_amount` (ADR 6). A receipt
-- groups a sale and the fee taken from it, so its amount is the signed sum of
-- what it settles — the net that reached the account — and is never supplied
-- by the caller: a receipt is created empty and gains its amount as its
-- settlements land.
--
-- `receipts_amount_nonnegative` checks the result row by row, which is the
-- whole set rule: a total that never goes below zero cannot hold a deduction
-- without a positive item beside it. So writers keep an order — settle the
-- positive item before its deduction, void the deduction before the item —
-- and a negative running total fails at the statement, not at commit. The
-- same holds for payments (`payments_amount_nonnegative`).
CREATE OR REPLACE FUNCTION refresh_receipt_amount() RETURNS trigger AS $$
DECLARE
  target_book integer;
  target_receipt integer;
BEGIN
  target_book := COALESCE(NEW.book_id, OLD.book_id);
  target_receipt := COALESCE(NEW.receipt_id, OLD.receipt_id);

  UPDATE receipts
     SET amount = COALESCE((
           SELECT SUM(amount)
             FROM revenue_settlements
            WHERE book_id = target_book
              AND receipt_id = target_receipt
              AND voided_at IS NULL
         ), 0)
   WHERE book_id = target_book AND id = target_receipt;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS refresh_receipt_amount_trigger ON revenue_settlements;
--> statement-breakpoint
CREATE TRIGGER refresh_receipt_amount_trigger
  AFTER INSERT OR UPDATE OR DELETE ON revenue_settlements
  FOR EACH ROW EXECUTE FUNCTION refresh_receipt_amount();
--> statement-breakpoint
-- Two levels, and a group that holds no records.
--
-- Three rules a CHECK cannot state, because each needs to look at another row:
-- a category's group must itself be groupless (that is what fixes the depth at
-- two), the group's kind must match, and a group must not already hold records
-- posted directly to it. Without the last one every roll-up would have to mean
-- "direct plus descendants", and no total would be obviously right.
CREATE OR REPLACE FUNCTION category_group_rules() RETURNS trigger AS $$
DECLARE
  parent_parent integer;
  parent_kind text;
  posted integer;
  children integer;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT parent_id, kind INTO parent_parent, parent_kind
    FROM financial_categories
   WHERE book_id = NEW.book_id AND id = NEW.parent_id;

  IF parent_parent IS NOT NULL THEN
    RAISE EXCEPTION
      'financial_categories nest one level: the chosen group is already inside a group'
      USING ERRCODE = '23514';
  END IF;

  IF parent_kind IS DISTINCT FROM NEW.kind THEN
    RAISE EXCEPTION
      'a % category cannot sit inside a % group', NEW.kind, parent_kind
      USING ERRCODE = '23514';
  END IF;

  -- Moving a group under another would make a third level out of its children.
  SELECT count(*) INTO children
    FROM financial_categories WHERE book_id = NEW.book_id AND parent_id = NEW.id;
  IF children > 0 THEN
    RAISE EXCEPTION
      'this category is itself a group and cannot be nested'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO posted FROM (
    SELECT 1 FROM expenses
     WHERE book_id = NEW.book_id AND financial_category_id = NEW.parent_id
    UNION ALL
    SELECT 1 FROM revenues
     WHERE book_id = NEW.book_id AND financial_category_id = NEW.parent_id
  ) AS used;
  IF posted > 0 THEN
    RAISE EXCEPTION
      'the chosen group already has records posted directly to it'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS category_group_rules_trigger ON financial_categories;
--> statement-breakpoint
CREATE TRIGGER category_group_rules_trigger
  BEFORE INSERT OR UPDATE ON financial_categories
  FOR EACH ROW EXECUTE FUNCTION category_group_rules();
--> statement-breakpoint
-- The other direction of the same rule: a group is not a place to post to.
-- One function serves both tables, so the two can never drift apart.
CREATE OR REPLACE FUNCTION category_must_be_a_leaf() RETURNS trigger AS $$
DECLARE
  children integer;
BEGIN
  SELECT count(*) INTO children
    FROM financial_categories
   WHERE book_id = NEW.book_id AND parent_id = NEW.financial_category_id;

  IF children > 0 THEN
    RAISE EXCEPTION
      'that category is a group; post to one of the financial_categories inside it'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS expenses_category_leaf_trigger ON expenses;
--> statement-breakpoint
CREATE TRIGGER expenses_category_leaf_trigger
  BEFORE INSERT OR UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION category_must_be_a_leaf();
--> statement-breakpoint
DROP TRIGGER IF EXISTS revenues_category_leaf_trigger ON revenues;
--> statement-breakpoint
CREATE TRIGGER revenues_category_leaf_trigger
  BEFORE INSERT OR UPDATE ON revenues
  FOR EACH ROW EXECUTE FUNCTION category_must_be_a_leaf();
--> statement-breakpoint
-- Signed items (ADR 6): a revenue or expense is negative exactly
-- when its category is a deduction one — the acquirer's fee on a sale, a
-- discount on a bill. The sign and the role say the same thing, so a negative
-- item outside a DEDUCTION category, or a positive one inside it, is a
-- booking in the wrong direction. A category inherits its group's role.
-- Mirrors `assertSignedItem` in the domain; zero is the CHECKs' to refuse.
CREATE OR REPLACE FUNCTION category_is_deduction(
  target_book integer, target_category integer
) RETURNS boolean AS $$
  SELECT COALESCE(c.role = 'DEDUCTION' OR p.role = 'DEDUCTION', false)
    FROM financial_categories c
    LEFT JOIN financial_categories p ON p.book_id = c.book_id AND p.id = c.parent_id
   WHERE c.book_id = target_book AND c.id = target_category;
$$ LANGUAGE sql STABLE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION item_sign_matches_category() RETURNS trigger AS $$
DECLARE
  deduction boolean;
BEGIN
  IF NEW.amount = 0 THEN
    RETURN NEW; -- the amount CHECK refuses this row on its own
  END IF;

  deduction := category_is_deduction(NEW.book_id, NEW.financial_category_id);
  IF deduction IS NULL THEN
    RETURN NEW; -- the foreign key rejects this row on its own
  END IF;

  IF NEW.amount < 0 AND NOT deduction THEN
    RAISE EXCEPTION
      'a negative % of % needs a DEDUCTION category', TG_TABLE_NAME, NEW.amount
      USING ERRCODE = '23514';
  END IF;

  IF NEW.amount > 0 AND deduction THEN
    RAISE EXCEPTION
      'a DEDUCTION category holds negative % only, not %', TG_TABLE_NAME, NEW.amount
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS revenues_item_sign_matches_category_trigger ON revenues;
--> statement-breakpoint
CREATE TRIGGER revenues_item_sign_matches_category_trigger
  BEFORE INSERT OR UPDATE OF amount, financial_category_id ON revenues
  FOR EACH ROW EXECUTE FUNCTION item_sign_matches_category();
--> statement-breakpoint
DROP TRIGGER IF EXISTS expenses_item_sign_matches_category_trigger ON expenses;
--> statement-breakpoint
CREATE TRIGGER expenses_item_sign_matches_category_trigger
  BEFORE INSERT OR UPDATE OF amount, financial_category_id ON expenses
  FOR EACH ROW EXECUTE FUNCTION item_sign_matches_category();
--> statement-breakpoint
-- The category side of the same rule: giving a category (or its group) the
-- DEDUCTION role, taking it away, or moving the category under another group
-- must not leave an item on the wrong side. Runs BEFORE the update, so it
-- reasons about NEW; the category's children inherit its role and are
-- checked with it.
CREATE OR REPLACE FUNCTION category_keeps_item_sign() RETURNS trigger AS $$
DECLARE
  parent_role text;
  broken boolean;
BEGIN
  IF NEW.role IS NOT DISTINCT FROM OLD.role
     AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_id IS NOT NULL THEN
    SELECT role INTO parent_role
      FROM financial_categories
     WHERE book_id = NEW.book_id AND id = NEW.parent_id;
  END IF;

  WITH affected AS (
    SELECT NEW.id AS id,
           COALESCE(NEW.role = 'DEDUCTION' OR parent_role = 'DEDUCTION', false)
             AS deduction
    UNION ALL
    SELECT c.id, COALESCE(c.role = 'DEDUCTION' OR NEW.role = 'DEDUCTION', false)
      FROM financial_categories c
     WHERE c.book_id = NEW.book_id AND c.parent_id = NEW.id
  )
  SELECT EXISTS (
    SELECT 1 FROM affected a
      JOIN revenues r ON r.book_id = NEW.book_id AND r.financial_category_id = a.id
     WHERE (r.amount < 0) <> a.deduction
    UNION ALL
    SELECT 1 FROM affected a
      JOIN expenses e ON e.book_id = NEW.book_id AND e.financial_category_id = a.id
     WHERE (e.amount < 0) <> a.deduction
  ) INTO broken;

  IF broken THEN
    RAISE EXCEPTION
      'that change puts an item on the wrong side of the DEDUCTION role'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS category_keeps_item_sign_trigger ON financial_categories;
--> statement-breakpoint
CREATE TRIGGER category_keeps_item_sign_trigger
  BEFORE UPDATE OF role, parent_id ON financial_categories
  FOR EACH ROW EXECUTE FUNCTION category_keeps_item_sign();
--> statement-breakpoint
-- One window per purchase date, per account.
--
-- A CHECK cannot state it: overlap is a fact about two rows. And it has to be
-- stated, because promotion asks "which invoice does this purchase land on" and
-- two overlapping windows make the answer depend on row order — the same
-- purchase would file under a different invoice on a different day, silently.
CREATE OR REPLACE FUNCTION account_cycle_no_overlap() RETURNS trigger AS $$
DECLARE
  clash record;
BEGIN
  SELECT reference_month, starts_on, ends_on INTO clash
    FROM account_cycles
   WHERE book_id = NEW.book_id
     AND account_id = NEW.account_id
     AND id IS DISTINCT FROM NEW.id
     AND NEW.starts_on <= ends_on
     AND NEW.ends_on >= starts_on
   LIMIT 1;

  IF clash IS NOT NULL THEN
    RAISE EXCEPTION
      'window %..% overlaps the one already on % (%..%)',
      NEW.starts_on, NEW.ends_on,
      clash.reference_month, clash.starts_on, clash.ends_on
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS account_cycle_no_overlap_trigger ON account_cycles;
--> statement-breakpoint
CREATE TRIGGER account_cycle_no_overlap_trigger
  BEFORE INSERT OR UPDATE ON account_cycles
  FOR EACH ROW EXECUTE FUNCTION account_cycle_no_overlap();
--> statement-breakpoint
-- The mirror of `expense_settlement_within_total`, for the revenue cycle
-- (ADR 7): a revenue states its amount, as an expense does, and its active
-- settlements carry its sign (ADR 6) and never exceed it. A discount or the
-- acquirer's fee is a negative revenue, settled negative beside the sale it
-- reduces. Settled in parts by several receipts, a revenue keeps its amount;
-- what is settled says how much of it was received. The receipt is not a cap:
-- its amount is derived (`refresh_receipt_amount`), and only kept at or above
-- zero (`receipts_amount_nonnegative`).
CREATE OR REPLACE FUNCTION revenue_settlement_within_total() RETURNS trigger AS $$
DECLARE
  revenue_total bigint;
  allocated bigint;
BEGIN
  IF NEW.voided_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT amount INTO revenue_total
    FROM revenues
   WHERE book_id = NEW.book_id AND id = NEW.revenue_id;

  IF revenue_total IS NULL THEN
    RETURN NEW; -- the foreign key rejects this row on its own
  END IF;

  IF sign(NEW.amount) <> sign(revenue_total) THEN
    RAISE EXCEPTION
      'a revenue settlement of % does not carry the sign of its revenue %',
      NEW.amount, revenue_total
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO allocated
    FROM revenue_settlements
   WHERE book_id = NEW.book_id
     AND revenue_id = NEW.revenue_id
     AND voided_at IS NULL
     AND id IS DISTINCT FROM NEW.id;

  IF abs(allocated + NEW.amount) > abs(revenue_total) THEN
    RAISE EXCEPTION
      'revenue settlements (% + %) exceed revenue total %',
      allocated, NEW.amount, revenue_total
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS revenue_settlement_within_total_trigger ON revenue_settlements;
--> statement-breakpoint
CREATE TRIGGER revenue_settlement_within_total_trigger
  BEFORE INSERT OR UPDATE ON revenue_settlements
  FOR EACH ROW EXECUTE FUNCTION revenue_settlement_within_total();
--> statement-breakpoint
-- Account statement evidence (ADR 17): a movement's links are the records
-- it became. A payment movement's links leave its account (its payment, or a
-- transfer it is the source of); a receipt movement's land in it. A transfer
-- link moves the movement's whole amount, and a transfer has at most one link
-- per side.
CREATE OR REPLACE FUNCTION account_movement_link_matches() RETURNS trigger AS $$
DECLARE
  -- One function for both tables: the record columns differ, so they are read
  -- by name rather than as NEW.payment_id, which the other table lacks.
  is_payment boolean := TG_TABLE_NAME = 'payment_movement_links';
  cash_id integer := (to_jsonb(NEW) ->> CASE WHEN is_payment THEN 'payment_id' ELSE 'receipt_id' END)::integer;
  movement_account integer;
  movement_amount bigint;
  movement_currency text;
  cash_account integer;
  transfer_row transfers%ROWTYPE;
BEGIN
  IF is_payment THEN
    SELECT account_id, amount, currency INTO movement_account, movement_amount, movement_currency
      FROM payment_movements WHERE book_id = NEW.book_id AND id = NEW.movement_id;
  ELSE
    SELECT account_id, amount, currency INTO movement_account, movement_amount, movement_currency
      FROM receipt_movements WHERE book_id = NEW.book_id AND id = NEW.movement_id;
  END IF;
  IF movement_account IS NULL THEN
    RETURN NEW; -- the foreign key rejects this row on its own
  END IF;

  IF cash_id IS NOT NULL THEN
    IF is_payment THEN
      SELECT account_id INTO cash_account FROM payments WHERE book_id = NEW.book_id AND id = cash_id;
    ELSE
      SELECT account_id INTO cash_account FROM receipts WHERE book_id = NEW.book_id AND id = cash_id;
    END IF;
    IF cash_account IS DISTINCT FROM movement_account THEN
      RAISE EXCEPTION 'a % movement links to a record of its own account', CASE WHEN is_payment THEN 'payment' ELSE 'receipt' END
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.transfer_id IS NOT NULL THEN
    SELECT * INTO transfer_row FROM transfers WHERE book_id = NEW.book_id AND id = NEW.transfer_id;
    IF transfer_row.id IS NULL THEN
      RETURN NEW;
    END IF;
    IF (is_payment AND transfer_row.source_account_id <> movement_account)
       OR (NOT is_payment AND transfer_row.destination_account_id <> movement_account) THEN
      RAISE EXCEPTION 'a movement joins a transfer only from its % account', CASE WHEN is_payment THEN 'source' ELSE 'destination' END
        USING ERRCODE = '23514';
    END IF;
    IF transfer_row.amount <> movement_amount OR NEW.amount <> movement_amount
       OR transfer_row.currency <> movement_currency THEN
      RAISE EXCEPTION 'a movement of % joins only a transfer of the same amount', movement_amount
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payment_movement_links_match
  BEFORE INSERT OR UPDATE ON payment_movement_links
  FOR EACH ROW EXECUTE FUNCTION account_movement_link_matches();
--> statement-breakpoint
CREATE TRIGGER receipt_movement_links_match
  BEFORE INSERT OR UPDATE ON receipt_movement_links
  FOR EACH ROW EXECUTE FUNCTION account_movement_link_matches();
--> statement-breakpoint
CREATE UNIQUE INDEX payment_movement_links_transfer_uk
  ON payment_movement_links (book_id, transfer_id) WHERE transfer_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX receipt_movement_links_transfer_uk
  ON receipt_movement_links (book_id, transfer_id) WHERE transfer_id IS NOT NULL;
--> statement-breakpoint

-- A movement is POSTED exactly when it has links, and they add up to its
-- amount. Checked at commit: posting writes the links and the status in
-- either order.
CREATE OR REPLACE FUNCTION account_movement_links_balance() RETURNS trigger AS $$
DECLARE
  row_data jsonb := to_jsonb(COALESCE(NEW, OLD));
  is_payment boolean := TG_TABLE_NAME IN ('payment_movements', 'payment_movement_links');
  on_links boolean := TG_TABLE_NAME LIKE '%_links';
  book integer := (row_data ->> 'book_id')::integer;
  movement integer := (row_data ->> CASE WHEN on_links THEN 'movement_id' ELSE 'id' END)::integer;
  movement_status text;
  movement_amount bigint;
  linked bigint;
  link_count integer;
BEGIN
  IF is_payment THEN
    SELECT status, amount INTO movement_status, movement_amount
      FROM payment_movements WHERE book_id = book AND id = movement;
    SELECT count(*), COALESCE(sum(amount), 0) INTO link_count, linked
      FROM payment_movement_links WHERE book_id = book AND movement_id = movement;
  ELSE
    SELECT status, amount INTO movement_status, movement_amount
      FROM receipt_movements WHERE book_id = book AND id = movement;
    SELECT count(*), COALESCE(sum(amount), 0) INTO link_count, linked
      FROM receipt_movement_links WHERE book_id = book AND movement_id = movement;
  END IF;
  IF movement_status IS NULL THEN
    RETURN NULL;
  END IF;
  IF movement_status = 'POSTED' AND (link_count = 0 OR linked <> movement_amount) THEN
    RAISE EXCEPTION 'posted movement % links % of its %', movement, linked, movement_amount
      USING ERRCODE = '23514';
  END IF;
  IF movement_status <> 'POSTED' AND link_count > 0 THEN
    RAISE EXCEPTION 'movement % is % and still links records', movement, movement_status
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_movements_links_balance
  AFTER INSERT OR UPDATE ON payment_movements
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION account_movement_links_balance();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER receipt_movements_links_balance
  AFTER INSERT OR UPDATE ON receipt_movements
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION account_movement_links_balance();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_movement_links_balance
  AFTER INSERT OR UPDATE OR DELETE ON payment_movement_links
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION account_movement_links_balance();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER receipt_movement_links_balance
  AFTER INSERT OR UPDATE OR DELETE ON receipt_movement_links
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION account_movement_links_balance();
--> statement-breakpoint

-- Card statement evidence (ADR 18): an instalment link names a payment of
-- its own card, a settlement of that payment into the linked expense, and,
-- once seen, a line of the same card and instalment.
CREATE OR REPLACE FUNCTION card_movement_payment_matches() RETURNS trigger AS $$
DECLARE
  payment_account integer;
  linked_expense integer;
  settlement_row expense_settlements%ROWTYPE;
  movement_row card_movements%ROWTYPE;
BEGIN
  SELECT account_id INTO payment_account FROM payments
   WHERE book_id = NEW.book_id AND id = NEW.payment_id;
  IF payment_account IS DISTINCT FROM NEW.account_id THEN
    RAISE EXCEPTION 'an instalment is billed on a payment of its own card'
      USING ERRCODE = '23514';
  END IF;
  SELECT expense_id INTO linked_expense FROM card_movement_expenses
   WHERE book_id = NEW.book_id AND account_id = NEW.account_id AND expense_key = NEW.expense_key;
  SELECT * INTO settlement_row FROM expense_settlements
   WHERE book_id = NEW.book_id AND id = NEW.settlement_id;
  IF settlement_row.payment_id IS DISTINCT FROM NEW.payment_id
     OR settlement_row.expense_id IS DISTINCT FROM linked_expense THEN
    RAISE EXCEPTION 'an instalment''s settlement joins its expense to its payment'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.movement_id IS NOT NULL THEN
    SELECT * INTO movement_row FROM card_movements
     WHERE book_id = NEW.book_id AND id = NEW.movement_id;
    IF movement_row.account_id IS DISTINCT FROM NEW.account_id
       OR movement_row.expense_key IS DISTINCT FROM NEW.expense_key
       OR movement_row.installment_number IS DISTINCT FROM NEW.installment_number THEN
      RAISE EXCEPTION 'a card line shows only its own instalment'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER card_movement_payments_match
  BEFORE INSERT OR UPDATE ON card_movement_payments
  FOR EACH ROW EXECUTE FUNCTION card_movement_payment_matches();
--> statement-breakpoint
CREATE UNIQUE INDEX card_movement_payments_movement_uk
  ON card_movement_payments (book_id, movement_id) WHERE movement_id IS NOT NULL;
--> statement-breakpoint

-- An invoice payment's transfer lands in its own card with the line's amount.
CREATE OR REPLACE FUNCTION card_movement_transfer_matches() RETURNS trigger AS $$
DECLARE
  movement_row card_movements%ROWTYPE;
  transfer_row transfers%ROWTYPE;
BEGIN
  SELECT * INTO movement_row FROM card_movements WHERE book_id = NEW.book_id AND id = NEW.movement_id;
  SELECT * INTO transfer_row FROM transfers WHERE book_id = NEW.book_id AND id = NEW.transfer_id;
  IF movement_row.id IS NULL OR transfer_row.id IS NULL THEN
    RETURN NEW; -- the foreign keys reject this row on their own
  END IF;
  IF movement_row.account_id <> NEW.account_id
     OR transfer_row.destination_account_id <> NEW.account_id
     OR transfer_row.amount <> -movement_row.amount
     OR transfer_row.currency <> movement_row.currency THEN
    RAISE EXCEPTION 'an invoice payment joins only a transfer into its card of its amount'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER card_movement_transfers_match
  BEFORE INSERT OR UPDATE ON card_movement_transfers
  FOR EACH ROW EXECUTE FUNCTION card_movement_transfer_matches();
--> statement-breakpoint

-- A card line is POSTED exactly when one link names it: an instalment, or the
-- transfer of an invoice payment. Checked at commit: posting writes the link
-- and the status in either order.
CREATE OR REPLACE FUNCTION card_movement_posted_links() RETURNS trigger AS $$
DECLARE
  row_data jsonb := to_jsonb(COALESCE(NEW, OLD));
  old_data jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
  book integer := (row_data ->> 'book_id')::integer;
  checked integer[];
  movement integer;
  movement_status text;
  link_count integer;
BEGIN
  IF TG_TABLE_NAME = 'card_movements' THEN
    checked := ARRAY[(row_data ->> 'id')::integer];
  ELSE
    checked := ARRAY[(row_data ->> 'movement_id')::integer, (old_data ->> 'movement_id')::integer];
  END IF;
  FOREACH movement IN ARRAY checked LOOP
    CONTINUE WHEN movement IS NULL;
    SELECT status INTO movement_status FROM card_movements WHERE book_id = book AND id = movement;
    CONTINUE WHEN movement_status IS NULL;
    SELECT (SELECT count(*) FROM card_movement_payments WHERE book_id = book AND movement_id = movement)
         + (SELECT count(*) FROM card_movement_transfers WHERE book_id = book AND movement_id = movement)
      INTO link_count;
    IF (movement_status = 'POSTED') <> (link_count = 1) THEN
      RAISE EXCEPTION 'card line % is % and has % links', movement, movement_status, link_count
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER card_movements_posted_links
  AFTER INSERT OR UPDATE ON card_movements
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION card_movement_posted_links();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER card_movement_payments_posted_links
  AFTER INSERT OR UPDATE OR DELETE ON card_movement_payments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION card_movement_posted_links();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER card_movement_transfers_posted_links
  AFTER INSERT OR UPDATE OR DELETE ON card_movement_transfers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION card_movement_posted_links();
--> statement-breakpoint

-- Revenue movement evidence (ADR 19): a record is POSTED exactly when it links
-- one revenue per component it carries (gross always; discount and fee when
-- not zero), and each linked revenue has its component's sign. At commit.
CREATE OR REPLACE FUNCTION revenue_movement_posted_revenues() RETURNS trigger AS $$
DECLARE
  row_data jsonb := to_jsonb(COALESCE(NEW, OLD));
  book integer := (row_data ->> 'book_id')::integer;
  movement integer := (row_data ->> CASE WHEN TG_TABLE_NAME = 'revenue_movements' THEN 'id' ELSE 'movement_id' END)::integer;
  movement_row revenue_movements%ROWTYPE;
  expected integer;
  linked integer;
  wrong integer;
BEGIN
  SELECT * INTO movement_row FROM revenue_movements WHERE book_id = book AND id = movement;
  IF movement_row.id IS NULL THEN
    RETURN NULL;
  END IF;
  expected := movement_row.gross_recognized::integer + (movement_row.discount <> 0)::integer
            + (movement_row.fee <> 0)::integer + (movement_row.acquirer_fee <> 0)::integer;
  SELECT count(*),
         count(*) FILTER (WHERE (l.component = 'GROSS' AND r.amount <> movement_row.gross)
                             OR (l.component = 'DISCOUNT' AND r.amount <> -movement_row.discount)
                             OR (l.component = 'FEE' AND r.amount <> movement_row.fee)
                             OR (l.component = 'ACQUIRER_FEE' AND r.amount <> -movement_row.acquirer_fee)
                             OR (l.component = 'GROSS' AND NOT movement_row.gross_recognized))
    INTO linked, wrong
    FROM revenue_movement_links l
    JOIN revenues r ON r.book_id = l.book_id AND r.id = l.revenue_id
   WHERE l.book_id = book AND l.movement_id = movement;
  IF wrong > 0 THEN
    RAISE EXCEPTION 'revenue movement % links a revenue of another amount', movement USING ERRCODE = '23514';
  END IF;
  IF (movement_row.status = 'POSTED' AND linked <> expected) OR (movement_row.status <> 'POSTED' AND linked > 0) THEN
    RAISE EXCEPTION 'revenue movement % is % and links % of % revenues', movement, movement_row.status, linked, expected
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER revenue_movements_posted_revenues
  AFTER INSERT OR UPDATE ON revenue_movements
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION revenue_movement_posted_revenues();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER revenue_movement_links_posted_revenues
  AFTER INSERT OR UPDATE OR DELETE ON revenue_movement_links
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION revenue_movement_posted_revenues();
