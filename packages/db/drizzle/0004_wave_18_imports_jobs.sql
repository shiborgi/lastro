CREATE TABLE "imported_movements" (
  "id" serial NOT NULL,
  "book_id" integer NOT NULL,
  "provider" text NOT NULL,
  "provider_account_id" text NOT NULL,
  "external_reference" text NOT NULL,
  "kind" text NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency" text NOT NULL,
  "occurred_at" timestamp NOT NULL,
  "status" text NOT NULL DEFAULT 'REVIEW',
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "imported_movements_book_id_id_pk" PRIMARY KEY("book_id", "id"),
  CONSTRAINT "imported_movements_kind_check" CHECK ("kind" in ('DEBIT', 'CREDIT')),
  CONSTRAINT "imported_movements_status_check" CHECK ("status" in ('REVIEW', 'CONVERTED', 'UNCHANGED')),
  CONSTRAINT "imported_movements_amount_minor_positive" CHECK ("amount_minor" > 0),
  CONSTRAINT "imported_movements_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "jobs" (
  "id" serial NOT NULL,
  "book_id" integer NOT NULL,
  "type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 3,
  "next_run_at" timestamp NOT NULL,
  "leased_by" text,
  "leased_until" timestamp,
  "last_error" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "jobs_book_id_id_pk" PRIMARY KEY("book_id", "id"),
  CONSTRAINT "jobs_status_check" CHECK ("status" in ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED'))
);
--> statement-breakpoint
ALTER TABLE "imported_movements" ADD CONSTRAINT "imported_movements_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "books"("id");
--> statement-breakpoint
CREATE UNIQUE INDEX "imported_movements_book_provider_ref_uk" ON "imported_movements" ("book_id", "provider", "external_reference");
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "books"("id");
