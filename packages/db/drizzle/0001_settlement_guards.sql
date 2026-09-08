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
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO allocated
    FROM revenue_settlements
   WHERE book_id = NEW.book_id
     AND revenue_id = NEW.revenue_id
     AND voided_at IS NULL
     AND id IS DISTINCT FROM NEW.id;

  IF allocated + NEW.amount > revenue_total THEN
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
