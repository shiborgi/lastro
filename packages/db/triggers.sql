-- ============================================================================
-- Appended to the generated migration by `bun run db:regenerate`.
--
-- drizzle-kit emits tables, indexes and constraints — never triggers or
-- plpgsql. Everything in this file therefore has to survive regeneration by
-- being kept outside the generated artefact and re-appended to it. Without it
-- the migrations still apply and every table still exists; only the numbers go
-- wrong, quietly. `initialize.test.ts` fails if it goes missing.
-- ============================================================================

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

  SELECT COALESCE(SUM(amount), 0) INTO allocated
    FROM expense_settlements
   WHERE book_id = NEW.book_id
     AND expense_id = NEW.expense_id
     AND voided_at IS NULL
     AND id IS DISTINCT FROM NEW.id;

  IF allocated + NEW.amount > expense_total THEN
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
-- reported zero. This keeps it in step with the settlements.
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
    FROM categories
   WHERE book_id = NEW.book_id AND id = NEW.parent_id;

  IF parent_parent IS NOT NULL THEN
    RAISE EXCEPTION
      'categories nest one level: the chosen group is already inside a group'
      USING ERRCODE = '23514';
  END IF;

  IF parent_kind IS DISTINCT FROM NEW.kind THEN
    RAISE EXCEPTION
      'a % category cannot sit inside a % group', NEW.kind, parent_kind
      USING ERRCODE = '23514';
  END IF;

  -- Moving a group under another would make a third level out of its children.
  SELECT count(*) INTO children
    FROM categories WHERE book_id = NEW.book_id AND parent_id = NEW.id;
  IF children > 0 THEN
    RAISE EXCEPTION
      'this category is itself a group and cannot be nested'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO posted FROM (
    SELECT 1 FROM expenses
     WHERE book_id = NEW.book_id AND category_id = NEW.parent_id
    UNION ALL
    SELECT 1 FROM revenues
     WHERE book_id = NEW.book_id AND category_id = NEW.parent_id
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
DROP TRIGGER IF EXISTS category_group_rules_trigger ON categories;
--> statement-breakpoint
CREATE TRIGGER category_group_rules_trigger
  BEFORE INSERT OR UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION category_group_rules();
--> statement-breakpoint
-- The other direction of the same rule: a group is not a place to post to.
-- One function serves both tables, so the two can never drift apart.
CREATE OR REPLACE FUNCTION category_must_be_a_leaf() RETURNS trigger AS $$
DECLARE
  children integer;
BEGIN
  SELECT count(*) INTO children
    FROM categories
   WHERE book_id = NEW.book_id AND parent_id = NEW.category_id;

  IF children > 0 THEN
    RAISE EXCEPTION
      'that category is a group; post to one of the categories inside it'
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
-- One window per purchase date, per account.
--
-- A CHECK cannot state it: overlap is a fact about two rows. And it has to be
-- stated, because promotion asks "which invoice does this purchase land on" and
-- two overlapping windows make the answer depend on row order — the same
-- purchase would file under a different invoice on a different day, silently.
CREATE OR REPLACE FUNCTION account_reference_month_no_overlap() RETURNS trigger AS $$
DECLARE
  clash record;
BEGIN
  SELECT reference_month, start_date, end_date INTO clash
    FROM account_reference_month
   WHERE book_id = NEW.book_id
     AND account_id = NEW.account_id
     AND id IS DISTINCT FROM NEW.id
     AND NEW.start_date <= end_date
     AND NEW.end_date >= start_date
   LIMIT 1;

  IF clash IS NOT NULL THEN
    RAISE EXCEPTION
      'window %..% overlaps the one already on % (%..%)',
      NEW.start_date, NEW.end_date,
      clash.reference_month, clash.start_date, clash.end_date
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS account_reference_month_no_overlap_trigger ON account_reference_month;
--> statement-breakpoint
CREATE TRIGGER account_reference_month_no_overlap_trigger
  BEFORE INSERT OR UPDATE ON account_reference_month
  FOR EACH ROW EXECUTE FUNCTION account_reference_month_no_overlap();
--> statement-breakpoint
-- The mirror of `refresh_payment_amount`, for the revenue cycle.
--
-- Its absence was load-bearing in the wrong direction: a revenue aggregates a
-- day's settlements — an acquirer earns a day's sales in several lines — so
-- an amount supplied when the first line was promoted would stay at that
-- line's value while five more settled against it. Derived, the revenue is
-- always the sum of what it actually earned, and voiding one reduces it.
--
-- The receipt on the other side of each settlement carries no such trigger:
-- it is one per statement line by construction, so its amount is this line's
-- own figure, fixed once at creation like an expense's — nothing ever adds a
-- second settlement to it to derive from.
CREATE OR REPLACE FUNCTION refresh_revenue_amount() RETURNS trigger AS $$
DECLARE
  target_book integer;
  target_revenue integer;
BEGIN
  target_book := COALESCE(NEW.book_id, OLD.book_id);
  target_revenue := COALESCE(NEW.revenue_id, OLD.revenue_id);

  UPDATE revenues
     SET amount = COALESCE((
           SELECT SUM(amount)
             FROM revenue_settlements
            WHERE book_id = target_book
              AND revenue_id = target_revenue
              AND voided_at IS NULL
         ), 0)
   WHERE book_id = target_book AND id = target_revenue;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS refresh_revenue_amount_trigger ON revenue_settlements;
--> statement-breakpoint
CREATE TRIGGER refresh_revenue_amount_trigger
  AFTER INSERT OR UPDATE OR DELETE ON revenue_settlements
  FOR EACH ROW EXECUTE FUNCTION refresh_revenue_amount();
--> statement-breakpoint
-- The mirror of `expense_settlement_within_total`, for the revenue cycle.
--
-- Which side carries the fixed figure is inverted here. On the expense side the
-- expense is the commitment and `payments.amount` is derived, so the cap is the
-- expense total. On the revenue side `revenues.amount` is the derived one — a
-- revenue aggregates a day's lines — and the receipt is the fixed figure, one
-- per statement line, its amount that line's own deposit.
--
-- So the rule worth enforcing is the receipt's: you cannot allocate more money
-- than the deposit actually contained. Without this, two settlements racing for
-- the same receipt both won, and the ledger claimed 240 allocated out of 200
-- received. `createRevenueSettlement` already takes an advisory lock per
-- revenue and per receipt, which serialises the racers; this is what rejects
-- the loser.
--
-- ERRCODE 23514, as on the expense side: to a caller this is the same class of
-- failure as any other violated invariant.
CREATE OR REPLACE FUNCTION revenue_settlement_within_receipt() RETURNS trigger AS $$
DECLARE
  receipt_total bigint;
  allocated bigint;
BEGIN
  IF NEW.voided_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT amount INTO receipt_total
    FROM receipts
   WHERE book_id = NEW.book_id AND id = NEW.receipt_id;

  IF receipt_total IS NULL THEN
    RETURN NEW; -- the foreign key rejects this row on its own
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO allocated
    FROM revenue_settlements
   WHERE book_id = NEW.book_id
     AND receipt_id = NEW.receipt_id
     AND voided_at IS NULL
     AND id IS DISTINCT FROM NEW.id;

  IF allocated + NEW.amount > receipt_total THEN
    RAISE EXCEPTION
      'revenue settlements (% + %) exceed receipt total %',
      allocated, NEW.amount, receipt_total
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS revenue_settlement_within_receipt_trigger ON revenue_settlements;
--> statement-breakpoint
CREATE TRIGGER revenue_settlement_within_receipt_trigger
  BEFORE INSERT OR UPDATE ON revenue_settlements
  FOR EACH ROW EXECUTE FUNCTION revenue_settlement_within_receipt();
