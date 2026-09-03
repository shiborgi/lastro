CREATE TABLE "revenues" (
  "id" serial NOT NULL,
  "book_id" integer NOT NULL,
  "account_id" integer NOT NULL,
  "party_id" integer NOT NULL,
  "revenue_category_id" integer NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency" text NOT NULL,
  "occurred_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "revenues_book_id_id_pk" PRIMARY KEY("book_id", "id"),
  CONSTRAINT "revenues_amount_minor_positive" CHECK ("amount_minor" > 0),
  CONSTRAINT "revenues_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "receipts" (
  "id" serial NOT NULL,
  "book_id" integer NOT NULL,
  "account_id" integer NOT NULL,
  "party_id" integer,
  "amount_minor" bigint NOT NULL,
  "currency" text NOT NULL,
  "occurred_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "receipts_book_id_id_pk" PRIMARY KEY("book_id", "id"),
  CONSTRAINT "receipts_amount_minor_positive" CHECK ("amount_minor" > 0),
  CONSTRAINT "receipts_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "revenue_settlements" (
  "id" serial NOT NULL,
  "book_id" integer NOT NULL,
  "revenue_id" integer NOT NULL,
  "receipt_id" integer NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency" text NOT NULL,
  "voided_at" timestamp,
  "voided_by" text,
  "void_reason" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "revenue_settlements_book_id_id_pk" PRIMARY KEY("book_id", "id"),
  CONSTRAINT "revenue_settlements_amount_minor_positive" CHECK ("amount_minor" > 0),
  CONSTRAINT "revenue_settlements_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "transfers" (
  "id" serial NOT NULL,
  "book_id" integer NOT NULL,
  "source_payment_id" integer NOT NULL,
  "destination_receipt_id" integer NOT NULL,
  "correlation_id" text NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "transfers_book_id_id_pk" PRIMARY KEY("book_id", "id"),
  CONSTRAINT "transfers_amount_minor_positive" CHECK ("amount_minor" > 0),
  CONSTRAINT "transfers_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "revenues" ADD CONSTRAINT "revenues_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "books"("id");
--> statement-breakpoint
ALTER TABLE "revenues" ADD CONSTRAINT "revenues_book_id_account_id_fk" FOREIGN KEY ("book_id", "account_id") REFERENCES "accounts"("book_id", "id");
--> statement-breakpoint
ALTER TABLE "revenues" ADD CONSTRAINT "revenues_book_id_party_id_fk" FOREIGN KEY ("book_id", "party_id") REFERENCES "parties"("book_id", "id");
--> statement-breakpoint
ALTER TABLE "revenues" ADD CONSTRAINT "revenues_book_id_revenue_category_id_fk" FOREIGN KEY ("book_id", "revenue_category_id") REFERENCES "revenue_categories"("book_id", "id");
--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "books"("id");
--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_book_id_account_id_fk" FOREIGN KEY ("book_id", "account_id") REFERENCES "accounts"("book_id", "id");
--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_book_id_party_id_fk" FOREIGN KEY ("book_id", "party_id") REFERENCES "parties"("book_id", "id");
--> statement-breakpoint
ALTER TABLE "revenue_settlements" ADD CONSTRAINT "revenue_settlements_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "books"("id");
--> statement-breakpoint
ALTER TABLE "revenue_settlements" ADD CONSTRAINT "revenue_settlements_book_id_revenue_id_fk" FOREIGN KEY ("book_id", "revenue_id") REFERENCES "revenues"("book_id", "id");
--> statement-breakpoint
ALTER TABLE "revenue_settlements" ADD CONSTRAINT "revenue_settlements_book_id_receipt_id_fk" FOREIGN KEY ("book_id", "receipt_id") REFERENCES "receipts"("book_id", "id");
--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "books"("id");
--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_book_id_source_payment_fk" FOREIGN KEY ("book_id", "source_payment_id") REFERENCES "payments"("book_id", "id");
--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_book_id_destination_receipt_fk" FOREIGN KEY ("book_id", "destination_receipt_id") REFERENCES "receipts"("book_id", "id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_revenue_settlement() RETURNS trigger AS $$
DECLARE
  revenue_amount bigint;
  revenue_currency text;
  receipt_amount bigint;
  receipt_currency text;
  allocated_to_revenue bigint;
  allocated_to_receipt bigint;
BEGIN
  PERFORM 1 FROM revenues WHERE book_id = NEW.book_id AND id = NEW.revenue_id FOR UPDATE;
  PERFORM 1 FROM receipts WHERE book_id = NEW.book_id AND id = NEW.receipt_id FOR UPDATE;
  SELECT amount_minor, currency INTO revenue_amount, revenue_currency FROM revenues WHERE book_id = NEW.book_id AND id = NEW.revenue_id;
  SELECT amount_minor, currency INTO receipt_amount, receipt_currency FROM receipts WHERE book_id = NEW.book_id AND id = NEW.receipt_id;
  IF revenue_amount IS NULL OR receipt_amount IS NULL THEN RAISE EXCEPTION 'settlement records must exist in the same Book' USING ERRCODE = '23503'; END IF;
  IF NEW.currency <> revenue_currency OR NEW.currency <> receipt_currency THEN RAISE EXCEPTION 'settlement currency must match revenue and receipt' USING ERRCODE = '23514'; END IF;
  SELECT COALESCE(SUM(amount_minor), 0) INTO allocated_to_revenue FROM revenue_settlements WHERE book_id = NEW.book_id AND revenue_id = NEW.revenue_id AND voided_at IS NULL;
  SELECT COALESCE(SUM(amount_minor), 0) INTO allocated_to_receipt FROM revenue_settlements WHERE book_id = NEW.book_id AND receipt_id = NEW.receipt_id AND voided_at IS NULL;
  IF allocated_to_revenue + NEW.amount_minor > revenue_amount OR allocated_to_receipt + NEW.amount_minor > receipt_amount THEN RAISE EXCEPTION 'settlement exceeds available amount' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER revenue_settlements_validate BEFORE INSERT ON "revenue_settlements" FOR EACH ROW EXECUTE FUNCTION validate_revenue_settlement();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_revenue_settlement_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'revenue_settlements are immutable; void them instead'; END IF;
  IF OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL OR NEW.voided_by IS NULL
    OR NEW.book_id IS DISTINCT FROM OLD.book_id OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.revenue_id IS DISTINCT FROM OLD.revenue_id OR NEW.receipt_id IS DISTINCT FROM OLD.receipt_id
    OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'revenue_settlements are immutable; only an active settlement may be voided';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER revenue_settlements_immutable BEFORE UPDATE OR DELETE ON "revenue_settlements" FOR EACH ROW EXECUTE FUNCTION prevent_revenue_settlement_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_transfer_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND (NEW.book_id IS DISTINCT FROM OLD.book_id OR NEW.source_payment_id IS DISTINCT FROM OLD.source_payment_id OR NEW.destination_receipt_id IS DISTINCT FROM OLD.destination_receipt_id OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor OR NEW.currency IS DISTINCT FROM OLD.currency)) THEN
    RAISE EXCEPTION 'transfers are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER transfers_immutable BEFORE UPDATE OR DELETE ON "transfers" FOR EACH ROW EXECUTE FUNCTION prevent_transfer_mutation();
