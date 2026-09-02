ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "amount_minor" bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "currency" text NOT NULL DEFAULT 'USD';
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "installment_number" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "installment_count" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "occurred_at" timestamp NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_minor_nonnegative" CHECK ("amount_minor" >= 0);
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_installment_check" CHECK ("installment_number" >= 1 AND "installment_count" >= "installment_number");
--> statement-breakpoint
CREATE TABLE "payments" (
  "id" serial NOT NULL,
  "book_id" integer NOT NULL,
  "account_id" integer NOT NULL,
  "party_id" integer,
  "amount_minor" bigint NOT NULL,
  "currency" text NOT NULL,
  "occurred_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "payments_book_id_id_pk" PRIMARY KEY("book_id", "id"),
  CONSTRAINT "payments_amount_minor_positive" CHECK ("amount_minor" > 0),
  CONSTRAINT "payments_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "expense_settlements" (
  "id" serial NOT NULL,
  "book_id" integer NOT NULL,
  "expense_id" integer NOT NULL,
  "payment_id" integer NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency" text NOT NULL,
  "voided_at" timestamp,
  "voided_by" text,
  "void_reason" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "expense_settlements_book_id_id_pk" PRIMARY KEY("book_id", "id"),
  CONSTRAINT "expense_settlements_amount_minor_positive" CHECK ("amount_minor" > 0),
  CONSTRAINT "expense_settlements_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
  "book_id" integer NOT NULL,
  "key" text NOT NULL,
  "operation" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "idempotency_records_book_id_key_pk" PRIMARY KEY("book_id", "key")
);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "books"("id");
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_book_id_account_id_fk" FOREIGN KEY ("book_id", "account_id") REFERENCES "accounts"("book_id", "id");
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_book_id_party_id_fk" FOREIGN KEY ("book_id", "party_id") REFERENCES "parties"("book_id", "id");
--> statement-breakpoint
ALTER TABLE "expense_settlements" ADD CONSTRAINT "expense_settlements_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "books"("id");
--> statement-breakpoint
ALTER TABLE "expense_settlements" ADD CONSTRAINT "expense_settlements_book_id_expense_id_fk" FOREIGN KEY ("book_id", "expense_id") REFERENCES "expenses"("book_id", "id");
--> statement-breakpoint
ALTER TABLE "expense_settlements" ADD CONSTRAINT "expense_settlements_book_id_payment_id_fk" FOREIGN KEY ("book_id", "payment_id") REFERENCES "payments"("book_id", "id");
--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "books"("id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_expense_settlement() RETURNS trigger AS $$
DECLARE
  expense_amount bigint;
  expense_currency text;
  payment_amount bigint;
  payment_currency text;
  allocated_to_expense bigint;
  allocated_to_payment bigint;
BEGIN
  -- Lock in a stable order so competing settlements serialize without deadlocks.
  PERFORM 1 FROM expenses WHERE book_id = NEW.book_id AND id = NEW.expense_id FOR UPDATE;
  PERFORM 1 FROM payments WHERE book_id = NEW.book_id AND id = NEW.payment_id FOR UPDATE;
  SELECT amount_minor, currency INTO expense_amount, expense_currency FROM expenses WHERE book_id = NEW.book_id AND id = NEW.expense_id;
  SELECT amount_minor, currency INTO payment_amount, payment_currency FROM payments WHERE book_id = NEW.book_id AND id = NEW.payment_id;
  IF expense_amount IS NULL OR payment_amount IS NULL THEN RAISE EXCEPTION 'settlement records must exist in the same Book' USING ERRCODE = '23503'; END IF;
  IF NEW.currency <> expense_currency OR NEW.currency <> payment_currency THEN RAISE EXCEPTION 'settlement currency must match expense and payment' USING ERRCODE = '23514'; END IF;
  SELECT COALESCE(SUM(amount_minor), 0) INTO allocated_to_expense FROM expense_settlements WHERE book_id = NEW.book_id AND expense_id = NEW.expense_id AND voided_at IS NULL;
  SELECT COALESCE(SUM(amount_minor), 0) INTO allocated_to_payment FROM expense_settlements WHERE book_id = NEW.book_id AND payment_id = NEW.payment_id AND voided_at IS NULL;
  IF allocated_to_expense + NEW.amount_minor > expense_amount OR allocated_to_payment + NEW.amount_minor > payment_amount THEN RAISE EXCEPTION 'settlement exceeds available amount' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER expense_settlements_validate BEFORE INSERT ON "expense_settlements" FOR EACH ROW EXECUTE FUNCTION validate_expense_settlement();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_expense_settlement_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'expense_settlements are immutable; void them instead'; END IF;
  IF OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL OR NEW.voided_by IS NULL
    OR NEW.book_id IS DISTINCT FROM OLD.book_id OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.expense_id IS DISTINCT FROM OLD.expense_id OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
    OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'expense_settlements are immutable; only an active settlement may be voided';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER expense_settlements_immutable BEFORE UPDATE OR DELETE ON "expense_settlements" FOR EACH ROW EXECUTE FUNCTION prevent_expense_settlement_mutation();
