CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_dates" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"reference_month" date NOT NULL,
	"close_date" timestamp NOT NULL,
	"due_date" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "account_dates_book_id_id_pk" PRIMARY KEY("book_id","id")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"key" text NOT NULL,
	"institution_id" integer,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_book_id_id_pk" PRIMARY KEY("book_id","id")
);
--> statement-breakpoint
CREATE TABLE "agent_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" integer NOT NULL,
	"principal" text NOT NULL,
	"delegated_operator" text NOT NULL,
	"secret_hash" text NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_type" text NOT NULL,
	"actor_principal" text NOT NULL,
	"delegated_operator" text NOT NULL,
	"book_id" integer NOT NULL,
	"source" text NOT NULL,
	"correlation_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_actor_type_check" CHECK ("audit_events"."actor_type" in ('USER', 'ASSISTANT', 'SYSTEM')),
	CONSTRAINT "audit_events_source_check" CHECK ("audit_events"."source" in ('WEB', 'API', 'MCP', 'WORKER'))
);
--> statement-breakpoint
CREATE TABLE "book_members" (
	"book_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "book_members_book_id_user_id_pk" PRIMARY KEY("book_id","user_id"),
	CONSTRAINT "book_members_role_check" CHECK ("book_members"."role" in ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER'))
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "categories_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "categories_kind_check" CHECK ("categories"."kind" in ('EXPENSE', 'REVENUE'))
);
--> statement-breakpoint
CREATE TABLE "expense_settlements" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"expense_id" integer NOT NULL,
	"payment_id" integer NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"installment_number" integer NOT NULL,
	"installment_count" integer NOT NULL,
	"voided_at" timestamp,
	"voided_by" text,
	"void_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "expense_settlements_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "expense_settlements_amount_positive" CHECK ("expense_settlements"."amount" > 0),
	CONSTRAINT "expense_settlements_currency_check" CHECK ("expense_settlements"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "expense_settlements_installment_check" CHECK ("expense_settlements"."installment_number" >= 1 and "expense_settlements"."installment_count" >= "expense_settlements"."installment_number")
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"key" text NOT NULL,
	"party_id" integer NOT NULL,
	"category_id" integer NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"reference_month" date NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "expenses_book_id_id_currency_uk" UNIQUE("book_id","id","currency")
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"book_id" integer NOT NULL,
	"key" text NOT NULL,
	"operation" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_records_book_id_key_pk" PRIMARY KEY("book_id","key")
);
--> statement-breakpoint
CREATE TABLE "institutions" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "institutions_book_id_id_pk" PRIMARY KEY("book_id","id")
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "parties_book_id_id_pk" PRIMARY KEY("book_id","id")
);
--> statement-breakpoint
CREATE TABLE "party_alias" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"key" text NOT NULL,
	"party_id" integer,
	"category_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "party_alias_book_id_id_pk" PRIMARY KEY("book_id","id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"reference_month" date NOT NULL,
	"due_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payments_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "payments_book_id_id_currency_uk" UNIQUE("book_id","id","currency"),
	CONSTRAINT "payments_amount_nonnegative" CHECK ("payments"."amount" >= 0),
	CONSTRAINT "payments_currency_check" CHECK ("payments"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"reference_month" date NOT NULL,
	"due_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "receipts_book_id_id_currency_uk" UNIQUE("book_id","id","currency"),
	CONSTRAINT "receipts_amount_positive" CHECK ("receipts"."amount" > 0),
	CONSTRAINT "receipts_currency_check" CHECK ("receipts"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "revenue_settlements" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"revenue_id" integer NOT NULL,
	"receipt_id" integer NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"voided_at" timestamp,
	"voided_by" text,
	"void_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "revenue_settlements_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "revenue_settlements_amount_positive" CHECK ("revenue_settlements"."amount" > 0),
	CONSTRAINT "revenue_settlements_currency_check" CHECK ("revenue_settlements"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "revenues" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"key" text NOT NULL,
	"party_id" integer NOT NULL,
	"category_id" integer NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"reference_month" date NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "revenues_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "revenues_book_id_id_currency_uk" UNIQUE("book_id","id","currency"),
	CONSTRAINT "revenues_amount_positive" CHECK ("revenues"."amount" > 0),
	CONSTRAINT "revenues_currency_check" CHECK ("revenues"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"key" text NOT NULL,
	"source_account_id" integer NOT NULL,
	"destination_account_id" integer NOT NULL,
	"correlation_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"reference_month" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "transfers_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "transfers_amount_positive" CHECK ("transfers"."amount" > 0),
	CONSTRAINT "transfers_currency_check" CHECK ("transfers"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_dates" ADD CONSTRAINT "account_dates_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_dates" ADD CONSTRAINT "account_dates_book_id_account_id_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_book_id_institution_id_fk" FOREIGN KEY ("book_id","institution_id") REFERENCES "public"."institutions"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_book_id_operator_fk" FOREIGN KEY ("book_id","delegated_operator") REFERENCES "public"."book_members"("book_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_members" ADD CONSTRAINT "book_members_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_members" ADD CONSTRAINT "book_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_settlements" ADD CONSTRAINT "expense_settlements_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_settlements" ADD CONSTRAINT "expense_settlements_book_id_expense_id_fk" FOREIGN KEY ("book_id","expense_id","currency") REFERENCES "public"."expenses"("book_id","id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_settlements" ADD CONSTRAINT "expense_settlements_book_id_payment_id_fk" FOREIGN KEY ("book_id","payment_id","currency") REFERENCES "public"."payments"("book_id","id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_book_id_party_id_fk" FOREIGN KEY ("book_id","party_id") REFERENCES "public"."parties"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_book_id_category_id_fk" FOREIGN KEY ("book_id","category_id") REFERENCES "public"."categories"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institutions" ADD CONSTRAINT "institutions_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_alias" ADD CONSTRAINT "party_alias_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_alias" ADD CONSTRAINT "party_alias_book_id_account_id_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_alias" ADD CONSTRAINT "party_alias_book_id_party_id_fk" FOREIGN KEY ("book_id","party_id") REFERENCES "public"."parties"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_alias" ADD CONSTRAINT "party_alias_book_id_category_id_fk" FOREIGN KEY ("book_id","category_id") REFERENCES "public"."categories"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_book_id_account_id_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_book_id_account_id_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_settlements" ADD CONSTRAINT "revenue_settlements_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_settlements" ADD CONSTRAINT "revenue_settlements_book_id_revenue_id_fk" FOREIGN KEY ("book_id","revenue_id","currency") REFERENCES "public"."revenues"("book_id","id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_settlements" ADD CONSTRAINT "revenue_settlements_book_id_receipt_id_fk" FOREIGN KEY ("book_id","receipt_id","currency") REFERENCES "public"."receipts"("book_id","id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenues" ADD CONSTRAINT "revenues_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenues" ADD CONSTRAINT "revenues_book_id_party_id_fk" FOREIGN KEY ("book_id","party_id") REFERENCES "public"."parties"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenues" ADD CONSTRAINT "revenues_book_id_category_id_fk" FOREIGN KEY ("book_id","category_id") REFERENCES "public"."categories"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_book_id_source_account_fk" FOREIGN KEY ("book_id","source_account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_book_id_destination_account_fk" FOREIGN KEY ("book_id","destination_account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_dates_book_account_month_uk" ON "account_dates" USING btree ("book_id","account_id","reference_month");--> statement-breakpoint
CREATE INDEX "account_dates_book_id_reference_month_idx" ON "account_dates" USING btree ("book_id","reference_month");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_book_id_key_uk" ON "accounts" USING btree ("book_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_book_id_key_uk" ON "expenses" USING btree ("book_id","key");--> statement-breakpoint
CREATE INDEX "expenses_book_id_reference_month_idx" ON "expenses" USING btree ("book_id","reference_month");--> statement-breakpoint
CREATE UNIQUE INDEX "institutions_book_id_key_uk" ON "institutions" USING btree ("book_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "parties_book_id_key_uk" ON "parties" USING btree ("book_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "party_alias_book_id_key_uk" ON "party_alias" USING btree ("book_id","key");--> statement-breakpoint
CREATE INDEX "payments_book_id_reference_month_idx" ON "payments" USING btree ("book_id","reference_month");--> statement-breakpoint
CREATE INDEX "receipts_book_id_reference_month_idx" ON "receipts" USING btree ("book_id","reference_month");--> statement-breakpoint
CREATE UNIQUE INDEX "revenues_book_id_key_uk" ON "revenues" USING btree ("book_id","key");--> statement-breakpoint
CREATE INDEX "revenues_book_id_reference_month_idx" ON "revenues" USING btree ("book_id","reference_month");--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_book_id_key_uk" ON "transfers" USING btree ("book_id","key");--> statement-breakpoint
CREATE INDEX "transfers_book_id_reference_month_idx" ON "transfers" USING btree ("book_id","reference_month");