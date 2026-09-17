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
CREATE TABLE "account_descriptors" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"key" text NOT NULL,
	"party_id" integer,
	"category_id" integer,
	"method" text,
	"counter_account_id" integer,
	"name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "account_descriptors_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "account_descriptors_book_id_account_id_key_uk" UNIQUE("book_id","account_id","key"),
	CONSTRAINT "account_descriptors_method_check" CHECK ("account_descriptors"."method" is null or "account_descriptors"."method" in ('PIX', 'BOLETO', 'TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD'))
);
--> statement-breakpoint
CREATE TABLE "account_reference_month" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"reference_month" date NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "account_reference_month_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "account_reference_month_window_check" CHECK ("account_reference_month"."start_date" <= "account_reference_month"."end_date")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"key" text NOT NULL,
	"institution_id" integer,
	"number" text,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "accounts_type_check" CHECK ("accounts"."type" in ('CARD', 'ACCOUNT', 'INVESTMENT', 'CASH'))
);
--> statement-breakpoint
CREATE TABLE "card_descriptors" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"key" text NOT NULL,
	"party_id" integer,
	"category_id" integer,
	"name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "card_descriptors_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "card_descriptors_book_id_account_id_key_uk" UNIQUE("book_id","account_id","key")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "categories_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "categories_kind_check" CHECK ("categories"."kind" in ('EXPENSE', 'REVENUE')),
	CONSTRAINT "categories_self_parent_check" CHECK ("categories"."parent_id" is null or "categories"."parent_id" <> "categories"."id")
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
CREATE TABLE "expense_settlements" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"expense_id" integer NOT NULL,
	"payment_id" integer NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"installment_number" integer NOT NULL,
	"installment_count" integer NOT NULL,
	"description" text,
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
	"name" text,
	"amount" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"reference_month" date NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "expenses_book_id_id_currency_uk" UNIQUE("book_id","id","currency")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"key" text,
	"method" text,
	"amount" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"reference_month" date NOT NULL,
	"due_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payments_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "payments_book_id_id_currency_uk" UNIQUE("book_id","id","currency"),
	CONSTRAINT "payments_amount_nonnegative" CHECK ("payments"."amount" >= 0),
	CONSTRAINT "payments_currency_check" CHECK ("payments"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payments_method_check" CHECK ("payments"."method" is null or "payments"."method" in ('PIX', 'BOLETO', 'TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD'))
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"key" text,
	"method" text,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"reference_month" date NOT NULL,
	"due_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "receipts_book_id_id_currency_uk" UNIQUE("book_id","id","currency"),
	CONSTRAINT "receipts_amount_positive" CHECK ("receipts"."amount" > 0),
	CONSTRAINT "receipts_currency_check" CHECK ("receipts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "receipts_method_check" CHECK ("receipts"."method" is null or "receipts"."method" in ('PIX', 'BOLETO', 'TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD'))
);
--> statement-breakpoint
CREATE TABLE "revenue_settlements" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"revenue_id" integer NOT NULL,
	"receipt_id" integer NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"description" text,
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
	"name" text,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"reference_month" date NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "revenues_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "revenues_book_id_id_currency_uk" UNIQUE("book_id","id","currency"),
	CONSTRAINT "revenues_amount_nonnegative" CHECK ("revenues"."amount" >= 0),
	CONSTRAINT "revenues_currency_check" CHECK ("revenues"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"key" text NOT NULL,
	"source_account_id" integer NOT NULL,
	"destination_account_id" integer NOT NULL,
	"name" text,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"reference_month" date NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "transfers_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "transfers_amount_positive" CHECK ("transfers"."amount" > 0),
	CONSTRAINT "transfers_currency_check" CHECK ("transfers"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "account_movements" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"institution_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"source" text NOT NULL,
	"key" text NOT NULL,
	"occurrence" integer NOT NULL,
	"purchase_date" date NOT NULL,
	"branch" text,
	"account_number" text,
	"category" text,
	"title" text,
	"description" text NOT NULL,
	"descriptor_key" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"expense_id" integer,
	"revenue_id" integer,
	"transfer_id" integer,
	"imported_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "account_movements_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "account_movements_status_check" CHECK ("account_movements"."status" in ('PENDING', 'IGNORED', 'POSTED')),
	CONSTRAINT "account_movements_posted_link_check" CHECK (("account_movements"."status" = 'POSTED') = (("account_movements"."expense_id" is not null)::int + ("account_movements"."revenue_id" is not null)::int + ("account_movements"."transfer_id" is not null)::int = 1)),
	CONSTRAINT "account_movements_occurrence_check" CHECK ("account_movements"."occurrence" >= 1)
);
--> statement-breakpoint
CREATE TABLE "card_movements" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"institution_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"source" text NOT NULL,
	"key" text NOT NULL,
	"occurrence" integer NOT NULL,
	"purchase_date" date NOT NULL,
	"cardholder" text,
	"card_number" text,
	"category" text,
	"title" text,
	"description" text NOT NULL,
	"descriptor_key" text NOT NULL,
	"installment_number" integer,
	"installment_count" integer,
	"amount" bigint NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"expense_id" integer,
	"revenue_id" integer,
	"transfer_id" integer,
	"imported_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "card_movements_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "card_movements_status_check" CHECK ("card_movements"."status" in ('PENDING', 'IGNORED', 'POSTED')),
	CONSTRAINT "card_movements_posted_link_check" CHECK (("card_movements"."status" = 'POSTED') = (("card_movements"."expense_id" is not null)::int + ("card_movements"."revenue_id" is not null)::int + ("card_movements"."transfer_id" is not null)::int = 1)),
	CONSTRAINT "card_movements_occurrence_check" CHECK ("card_movements"."occurrence" >= 1)
);
--> statement-breakpoint
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_book_id_operator_fk" FOREIGN KEY ("book_id","delegated_operator") REFERENCES "public"."book_members"("book_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_members" ADD CONSTRAINT "book_members_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_members" ADD CONSTRAINT "book_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_descriptors" ADD CONSTRAINT "account_descriptors_book_id_account_id_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_descriptors" ADD CONSTRAINT "account_descriptors_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_descriptors" ADD CONSTRAINT "account_descriptors_book_id_party_id_fk" FOREIGN KEY ("book_id","party_id") REFERENCES "public"."parties"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_descriptors" ADD CONSTRAINT "account_descriptors_book_id_category_id_fk" FOREIGN KEY ("book_id","category_id") REFERENCES "public"."categories"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_descriptors" ADD CONSTRAINT "account_descriptors_book_id_counter_account_id_fk" FOREIGN KEY ("book_id","counter_account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_reference_month" ADD CONSTRAINT "account_reference_month_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_reference_month" ADD CONSTRAINT "account_reference_month_book_id_account_id_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_book_id_institution_id_fk" FOREIGN KEY ("book_id","institution_id") REFERENCES "public"."institutions"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_descriptors" ADD CONSTRAINT "card_descriptors_book_id_account_id_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_descriptors" ADD CONSTRAINT "card_descriptors_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_descriptors" ADD CONSTRAINT "card_descriptors_book_id_party_id_fk" FOREIGN KEY ("book_id","party_id") REFERENCES "public"."parties"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_descriptors" ADD CONSTRAINT "card_descriptors_book_id_category_id_fk" FOREIGN KEY ("book_id","category_id") REFERENCES "public"."categories"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_book_id_parent_id_fk" FOREIGN KEY ("book_id","parent_id") REFERENCES "public"."categories"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institutions" ADD CONSTRAINT "institutions_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_settlements" ADD CONSTRAINT "expense_settlements_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_settlements" ADD CONSTRAINT "expense_settlements_book_id_expense_id_fk" FOREIGN KEY ("book_id","expense_id","currency") REFERENCES "public"."expenses"("book_id","id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_settlements" ADD CONSTRAINT "expense_settlements_book_id_payment_id_fk" FOREIGN KEY ("book_id","payment_id","currency") REFERENCES "public"."payments"("book_id","id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_book_id_party_id_fk" FOREIGN KEY ("book_id","party_id") REFERENCES "public"."parties"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_book_id_category_id_fk" FOREIGN KEY ("book_id","category_id") REFERENCES "public"."categories"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_book_id_source_account_fk" FOREIGN KEY ("book_id","source_account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_book_id_destination_account_fk" FOREIGN KEY ("book_id","destination_account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_movements" ADD CONSTRAINT "account_movements_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_movements" ADD CONSTRAINT "account_movements_book_id_institution_id_fk" FOREIGN KEY ("book_id","institution_id") REFERENCES "public"."institutions"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_movements" ADD CONSTRAINT "account_movements_book_id_account_id_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_movements" ADD CONSTRAINT "account_movements_book_id_expense_id_fk" FOREIGN KEY ("book_id","expense_id") REFERENCES "public"."expenses"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_movements" ADD CONSTRAINT "account_movements_book_id_revenue_id_fk" FOREIGN KEY ("book_id","revenue_id") REFERENCES "public"."revenues"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_movements" ADD CONSTRAINT "account_movements_book_id_transfer_id_fk" FOREIGN KEY ("book_id","transfer_id") REFERENCES "public"."transfers"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_movements" ADD CONSTRAINT "account_movements_book_id_descriptor_key_fk" FOREIGN KEY ("book_id","account_id","descriptor_key") REFERENCES "public"."account_descriptors"("book_id","account_id","key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_movements" ADD CONSTRAINT "card_movements_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_movements" ADD CONSTRAINT "card_movements_book_id_institution_id_fk" FOREIGN KEY ("book_id","institution_id") REFERENCES "public"."institutions"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_movements" ADD CONSTRAINT "card_movements_book_id_account_id_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_movements" ADD CONSTRAINT "card_movements_book_id_expense_id_fk" FOREIGN KEY ("book_id","expense_id") REFERENCES "public"."expenses"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_movements" ADD CONSTRAINT "card_movements_book_id_revenue_id_fk" FOREIGN KEY ("book_id","revenue_id") REFERENCES "public"."revenues"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_movements" ADD CONSTRAINT "card_movements_book_id_transfer_id_fk" FOREIGN KEY ("book_id","transfer_id") REFERENCES "public"."transfers"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_movements" ADD CONSTRAINT "card_movements_book_id_descriptor_key_fk" FOREIGN KEY ("book_id","account_id","descriptor_key") REFERENCES "public"."card_descriptors"("book_id","account_id","key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_reference_month_book_account_month_uk" ON "account_reference_month" USING btree ("book_id","account_id","reference_month");--> statement-breakpoint
CREATE INDEX "account_reference_month_book_account_window_idx" ON "account_reference_month" USING btree ("book_id","account_id","start_date","end_date");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_book_id_key_uk" ON "accounts" USING btree ("book_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_book_institution_number_uk" ON "accounts" USING btree ("book_id","institution_id","number");--> statement-breakpoint
CREATE INDEX "categories_book_id_parent_id_idx" ON "categories" USING btree ("book_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "institutions_book_id_key_uk" ON "institutions" USING btree ("book_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "parties_book_id_key_uk" ON "parties" USING btree ("book_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_book_id_key_uk" ON "expenses" USING btree ("book_id","key");--> statement-breakpoint
CREATE INDEX "expenses_book_id_reference_month_idx" ON "expenses" USING btree ("book_id","reference_month");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_book_id_key_uk" ON "payments" USING btree ("book_id","key");--> statement-breakpoint
CREATE INDEX "payments_book_id_reference_month_idx" ON "payments" USING btree ("book_id","reference_month");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_book_id_key_uk" ON "receipts" USING btree ("book_id","key");--> statement-breakpoint
CREATE INDEX "receipts_book_id_reference_month_idx" ON "receipts" USING btree ("book_id","reference_month");--> statement-breakpoint
CREATE UNIQUE INDEX "revenues_book_id_key_uk" ON "revenues" USING btree ("book_id","key");--> statement-breakpoint
CREATE INDEX "revenues_book_id_reference_month_idx" ON "revenues" USING btree ("book_id","reference_month");--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_book_id_key_uk" ON "transfers" USING btree ("book_id","key");--> statement-breakpoint
CREATE INDEX "transfers_book_id_reference_month_idx" ON "transfers" USING btree ("book_id","reference_month");--> statement-breakpoint
CREATE UNIQUE INDEX "account_movements_book_id_key_occurrence_uk" ON "account_movements" USING btree ("book_id","key","occurrence");--> statement-breakpoint
CREATE INDEX "account_movements_book_id_status_idx" ON "account_movements" USING btree ("book_id","status");--> statement-breakpoint
CREATE INDEX "account_movements_book_id_purchase_date_idx" ON "account_movements" USING btree ("book_id","purchase_date");--> statement-breakpoint
CREATE INDEX "account_movements_book_id_descriptor_idx" ON "account_movements" USING btree ("book_id","account_id","descriptor_key");--> statement-breakpoint
CREATE UNIQUE INDEX "card_movements_book_id_key_occurrence_uk" ON "card_movements" USING btree ("book_id","key","occurrence");--> statement-breakpoint
CREATE INDEX "card_movements_book_id_status_idx" ON "card_movements" USING btree ("book_id","status");--> statement-breakpoint
CREATE INDEX "card_movements_book_id_purchase_date_idx" ON "card_movements" USING btree ("book_id","purchase_date");--> statement-breakpoint
CREATE INDEX "card_movements_book_id_descriptor_idx" ON "card_movements" USING btree ("book_id","account_id","descriptor_key");-- ============================================================================
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
