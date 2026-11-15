CREATE SEQUENCE "public"."account_movement_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;
--> statement-breakpoint
CREATE TABLE "agent_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" integer NOT NULL,
	"principal" text NOT NULL,
	"delegated_operator" text NOT NULL,
	"secret_hash" text NOT NULL,
	"revoked_at" timestamp with time zone
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
	"operation" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_actor_type_check" CHECK ("audit_events"."actor_type" in ('USER', 'ASSISTANT', 'SYSTEM')),
	CONSTRAINT "audit_events_source_check" CHECK ("audit_events"."source" in ('WEB', 'API', 'MCP', 'WORKER'))
);
--> statement-breakpoint
CREATE TABLE "auth_accounts" (
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
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "auth_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
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
	CONSTRAINT "book_members_book_id_user_id_pk" PRIMARY KEY("book_id","user_id"),
	CONSTRAINT "book_members_role_check" CHECK ("book_members"."role" in ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER'))
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"book_id" integer NOT NULL,
	"key" text NOT NULL,
	"operation" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_records_book_id_key_pk" PRIMARY KEY("book_id","key")
);
--> statement-breakpoint
CREATE TABLE "account_cycles" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"reference_month" date NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"due_on" date NOT NULL,
	CONSTRAINT "account_cycles_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "account_cycles_window_check" CHECK ("account_cycles"."starts_on" <= "account_cycles"."ends_on" and "account_cycles"."ends_on" <= "account_cycles"."due_on")
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
	CONSTRAINT "accounts_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "accounts_type_check" CHECK ("accounts"."type" in ('CARD', 'ACCOUNT', 'INVESTMENT', 'CASH'))
);
--> statement-breakpoint
CREATE TABLE "card_movement_descriptors" (
	"book_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"descriptor_key" text NOT NULL,
	"name" text NOT NULL,
	"party_id" integer,
	"financial_category_id" integer,
	"counter_account_id" integer,
	"payment_method" text,
	CONSTRAINT "card_movement_descriptors_pk" PRIMARY KEY("book_id","account_id","descriptor_key"),
	CONSTRAINT "card_movement_descriptors_payment_method_check" CHECK ("card_movement_descriptors"."payment_method" is null or "card_movement_descriptors"."payment_method" in ('PIX', 'BOLETO', 'TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD')),
	CONSTRAINT "card_movement_descriptors_mapping_check" CHECK ("card_movement_descriptors"."counter_account_id" is null or ("card_movement_descriptors"."party_id" is null and "card_movement_descriptors"."financial_category_id" is null and "card_movement_descriptors"."counter_account_id" <> "card_movement_descriptors"."account_id"))
);
--> statement-breakpoint
CREATE TABLE "card_movement_expenses" (
	"book_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"expense_key" text NOT NULL,
	"expense_id" integer NOT NULL,
	CONSTRAINT "card_movement_expenses_pk" PRIMARY KEY("book_id","account_id","expense_key")
);
--> statement-breakpoint
CREATE TABLE "card_movement_payments" (
	"book_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"payment_key" text NOT NULL,
	"expense_key" text NOT NULL,
	"installment_number" integer NOT NULL,
	"installment_count" integer NOT NULL,
	"payment_id" integer NOT NULL,
	"settlement_id" integer NOT NULL,
	"movement_id" integer,
	CONSTRAINT "card_movement_payments_pk" PRIMARY KEY("book_id","account_id","payment_key"),
	CONSTRAINT "card_movement_payments_installment_check" CHECK ("card_movement_payments"."installment_count" >= 1 and "card_movement_payments"."installment_number" between 1 and "card_movement_payments"."installment_count")
);
--> statement-breakpoint
CREATE TABLE "card_movement_transfers" (
	"book_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"movement_id" integer NOT NULL,
	"external_key" text NOT NULL,
	"statement_key" text NOT NULL,
	"transfer_id" integer NOT NULL,
	CONSTRAINT "card_movement_transfers_pk" PRIMARY KEY("book_id","movement_id"),
	CONSTRAINT "card_movement_transfers_statement_key_check" CHECK ("card_movement_transfers"."statement_key" ~ '^[ap][0-9]+-[A-Z_]+-[ap][0-9]+-[0-9]{8}-[0-9]+$')
);
--> statement-breakpoint
CREATE TABLE "card_movements" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"file_id" integer NOT NULL,
	"statement_id" text NOT NULL,
	"external_id" text NOT NULL,
	"payment_key" text NOT NULL,
	"expense_key" text NOT NULL,
	"occurred_on" date NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"name" text NOT NULL,
	"descriptor_key" text NOT NULL,
	"description" text NOT NULL,
	"cardholder" text,
	"card_last4" text,
	"provider_category" text,
	"installment_number" integer NOT NULL,
	"installment_count" integer NOT NULL,
	"party_id" integer,
	"financial_category_id" integer,
	"counter_account_id" integer,
	"payment_method" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"ignore_reason" text,
	CONSTRAINT "card_movements_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "card_movements_payment_method_check" CHECK ("card_movements"."payment_method" is null or "card_movements"."payment_method" in ('PIX', 'BOLETO', 'TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD')),
	CONSTRAINT "card_movements_mapping_check" CHECK ("card_movements"."counter_account_id" is null or ("card_movements"."party_id" is null and "card_movements"."financial_category_id" is null and "card_movements"."counter_account_id" <> "card_movements"."account_id")),
	CONSTRAINT "card_movements_amount_check" CHECK ("card_movements"."amount" <> 0),
	CONSTRAINT "card_movements_currency_check" CHECK ("card_movements"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "card_movements_installment_check" CHECK ("card_movements"."installment_count" >= 1 and "card_movements"."installment_number" between 1 and "card_movements"."installment_count"),
	CONSTRAINT "card_movements_status_check" CHECK ("card_movements"."status" in ('PENDING', 'POSTED', 'IGNORED') and ("card_movements"."status" = 'IGNORED') = ("card_movements"."ignore_reason" is not null))
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
	"voided_at" timestamp with time zone,
	"voided_by" text,
	"void_reason" text,
	CONSTRAINT "expense_settlements_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "expense_settlements_amount_nonzero" CHECK ("expense_settlements"."amount" <> 0),
	CONSTRAINT "expense_settlements_currency_check" CHECK ("expense_settlements"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "expense_settlements_installment_check" CHECK ("expense_settlements"."installment_number" >= 1 and "expense_settlements"."installment_count" >= "expense_settlements"."installment_number")
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"key" text NOT NULL,
	"party_id" integer NOT NULL,
	"financial_category_id" integer NOT NULL,
	"name" text,
	"amount" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"reference_month" date NOT NULL,
	"occurred_on" date,
	"occurred_at" timestamp with time zone,
	CONSTRAINT "expenses_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "expenses_book_id_id_currency_uk" UNIQUE("book_id","id","currency"),
	CONSTRAINT "expenses_amount_nonzero" CHECK ("expenses"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "financial_categories" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" integer,
	"role" text,
	CONSTRAINT "financial_categories_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "financial_categories_kind_check" CHECK ("financial_categories"."kind" in ('EXPENSE', 'REVENUE')),
	CONSTRAINT "financial_categories_role_check" CHECK ("financial_categories"."role" is null or "financial_categories"."role" = 'DEDUCTION' or ("financial_categories"."role" in ('FIXED', 'MERCHANDISE') and "financial_categories"."kind" = 'EXPENSE')),
	CONSTRAINT "financial_categories_self_parent_check" CHECK ("financial_categories"."parent_id" is null or "financial_categories"."parent_id" <> "financial_categories"."id")
);
--> statement-breakpoint
CREATE TABLE "institutions" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "institutions_book_id_id_pk" PRIMARY KEY("book_id","id")
);
--> statement-breakpoint
CREATE TABLE "movement_consumers" (
	"book_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"movement_type" text NOT NULL,
	"importer_id" text NOT NULL,
	"set_by" text NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movement_consumers_pk" PRIMARY KEY("book_id","account_id","movement_type"),
	CONSTRAINT "movement_consumers_movement_type_check" CHECK ("movement_consumers"."movement_type" ~ '^[a-z][a-z0-9-]{0,49}$' and length("movement_consumers"."importer_id") > 0)
);
--> statement-breakpoint
CREATE TABLE "movement_files" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"movement_type" text NOT NULL,
	"importer_id" text NOT NULL,
	"importer_version" integer NOT NULL,
	"importer_fingerprint" text NOT NULL,
	"content_sha256" text NOT NULL,
	"source_key" text NOT NULL,
	"line_count" integer NOT NULL,
	"new_count" integer NOT NULL,
	"imported_by" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movement_files_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "movement_files_counts_check" CHECK ("movement_files"."line_count" > 0 and "movement_files"."new_count" between 0 and "movement_files"."line_count" and "movement_files"."importer_version" > 0),
	CONSTRAINT "movement_files_sha256_check" CHECK ("movement_files"."content_sha256" ~ '^[0-9a-f]{64}$' and "movement_files"."importer_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	CONSTRAINT "parties_book_id_id_pk" PRIMARY KEY("book_id","id")
);
--> statement-breakpoint
CREATE TABLE "payment_movement_descriptors" (
	"book_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"descriptor_key" text NOT NULL,
	"name" text NOT NULL,
	"payment_method" text,
	"party_id" integer,
	"financial_category_id" integer,
	"counter_account_id" integer,
	"settlement_group" text,
	CONSTRAINT "payment_movement_descriptors_pk" PRIMARY KEY("book_id","account_id","descriptor_key"),
	CONSTRAINT "payment_movement_descriptors_payment_method_check" CHECK ("payment_movement_descriptors"."payment_method" is null or "payment_movement_descriptors"."payment_method" in ('PIX', 'BOLETO', 'TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD')),
	CONSTRAINT "payment_movement_descriptors_mapping_check" CHECK ("payment_movement_descriptors"."counter_account_id" is null or ("payment_movement_descriptors"."party_id" is null and "payment_movement_descriptors"."financial_category_id" is null and "payment_movement_descriptors"."counter_account_id" <> "payment_movement_descriptors"."account_id")),
	CONSTRAINT "payment_movement_descriptors_settlement_group_check" CHECK ("payment_movement_descriptors"."settlement_group" is null)
);
--> statement-breakpoint
CREATE TABLE "payment_movement_links" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"movement_id" integer NOT NULL,
	"external_key" text NOT NULL,
	"statement_key" text NOT NULL,
	"amount" bigint NOT NULL,
	"transfer_id" integer,
	"expense_id" integer,
	"expense_key" text,
	"payment_id" integer,
	"payment_key" text,
	CONSTRAINT "payment_movement_links_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "payment_movement_links_amount_positive" CHECK ("payment_movement_links"."amount" > 0),
	CONSTRAINT "payment_movement_links_target_check" CHECK (("payment_movement_links"."transfer_id" is not null and "payment_movement_links"."expense_id" is null and "payment_movement_links"."payment_id" is null and "payment_movement_links"."expense_key" is null and "payment_movement_links"."payment_key" is null)
          or ("payment_movement_links"."transfer_id" is null and "payment_movement_links"."expense_id" is not null and "payment_movement_links"."payment_id" is not null and "payment_movement_links"."expense_key" is not null and "payment_movement_links"."payment_key" is not null)
          ),
	CONSTRAINT "payment_movement_links_statement_key_check" CHECK ("payment_movement_links"."statement_key" ~ '^[ap][0-9]+-[A-Z_]+-[ap][0-9]+-[0-9]{8}-[0-9]+$')
);
--> statement-breakpoint
CREATE TABLE "payment_movements" (
	"id" integer DEFAULT nextval('account_movement_id_seq') NOT NULL,
	"book_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"file_id" integer NOT NULL,
	"external_id" text NOT NULL,
	"occurred_on" date NOT NULL,
	"occurred_at" timestamp with time zone,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"name" text NOT NULL,
	"descriptor_key" text NOT NULL,
	"description" text NOT NULL,
	"payment_method" text,
	"party_id" integer,
	"financial_category_id" integer,
	"counter_account_id" integer,
	"settlement_group" text,
	"promise" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"ignore_reason" text,
	CONSTRAINT "payment_movements_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "payment_movements_amount_positive" CHECK ("payment_movements"."amount" > 0),
	CONSTRAINT "payment_movements_currency_check" CHECK ("payment_movements"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payment_movements_payment_method_check" CHECK ("payment_movements"."payment_method" is null or "payment_movements"."payment_method" in ('PIX', 'BOLETO', 'TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD')),
	CONSTRAINT "payment_movements_status_check" CHECK ("payment_movements"."status" in ('PENDING', 'POSTED', 'IGNORED') and ("payment_movements"."status" = 'IGNORED') = ("payment_movements"."ignore_reason" is not null)),
	CONSTRAINT "payment_movements_mapping_check" CHECK ("payment_movements"."counter_account_id" is null or ("payment_movements"."party_id" is null and "payment_movements"."financial_category_id" is null and "payment_movements"."counter_account_id" <> "payment_movements"."account_id")),
	CONSTRAINT "payment_movements_settlement_group_check" CHECK ("payment_movements"."settlement_group" is null),
	CONSTRAINT "payment_movements_promise_check" CHECK (not "payment_movements"."promise")
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
	"due_on" date,
	"due_at" timestamp with time zone,
	"paid_on" date,
	"paid_at" timestamp with time zone,
	CONSTRAINT "payments_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "payments_book_id_id_currency_uk" UNIQUE("book_id","id","currency"),
	CONSTRAINT "payments_amount_nonnegative" CHECK ("payments"."amount" >= 0),
	CONSTRAINT "payments_currency_check" CHECK ("payments"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payments_method_check" CHECK ("payments"."method" is null or "payments"."method" in ('PIX', 'BOLETO', 'TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD'))
);
--> statement-breakpoint
CREATE TABLE "receipt_movement_descriptors" (
	"book_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"descriptor_key" text NOT NULL,
	"name" text NOT NULL,
	"payment_method" text,
	"party_id" integer,
	"financial_category_id" integer,
	"counter_account_id" integer,
	"settlement_group" text,
	CONSTRAINT "receipt_movement_descriptors_pk" PRIMARY KEY("book_id","account_id","descriptor_key"),
	CONSTRAINT "receipt_movement_descriptors_payment_method_check" CHECK ("receipt_movement_descriptors"."payment_method" is null or "receipt_movement_descriptors"."payment_method" in ('PIX', 'BOLETO', 'TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD')),
	CONSTRAINT "receipt_movement_descriptors_mapping_check" CHECK ("receipt_movement_descriptors"."counter_account_id" is null or ("receipt_movement_descriptors"."party_id" is null and "receipt_movement_descriptors"."financial_category_id" is null and "receipt_movement_descriptors"."counter_account_id" <> "receipt_movement_descriptors"."account_id")),
	CONSTRAINT "receipt_movement_descriptors_settlement_group_check" CHECK ("receipt_movement_descriptors"."settlement_group" is null or ("receipt_movement_descriptors"."financial_category_id" is null and "receipt_movement_descriptors"."counter_account_id" is null))
);
--> statement-breakpoint
CREATE TABLE "receipt_movement_links" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"movement_id" integer NOT NULL,
	"external_key" text NOT NULL,
	"statement_key" text NOT NULL,
	"amount" bigint NOT NULL,
	"transfer_id" integer,
	"revenue_id" integer,
	"revenue_key" text,
	"receipt_id" integer,
	"receipt_key" text,
	CONSTRAINT "receipt_movement_links_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "receipt_movement_links_amount_positive" CHECK ("receipt_movement_links"."amount" > 0),
	CONSTRAINT "receipt_movement_links_target_check" CHECK (("receipt_movement_links"."transfer_id" is not null and "receipt_movement_links"."revenue_id" is null and "receipt_movement_links"."receipt_id" is null and "receipt_movement_links"."revenue_key" is null and "receipt_movement_links"."receipt_key" is null)
          or ("receipt_movement_links"."transfer_id" is null and "receipt_movement_links"."revenue_id" is not null and "receipt_movement_links"."receipt_id" is not null and "receipt_movement_links"."revenue_key" is not null and "receipt_movement_links"."receipt_key" is not null)
          or ("receipt_movement_links"."transfer_id" is null and "receipt_movement_links"."revenue_id" is null and "receipt_movement_links"."revenue_key" is null and "receipt_movement_links"."receipt_id" is not null and "receipt_movement_links"."receipt_key" is not null)),
	CONSTRAINT "receipt_movement_links_statement_key_check" CHECK ("receipt_movement_links"."statement_key" ~ '^[ap][0-9]+-[A-Z_]+-[ap][0-9]+-[0-9]{8}-[0-9]+$')
);
--> statement-breakpoint
CREATE TABLE "receipt_movements" (
	"id" integer DEFAULT nextval('account_movement_id_seq') NOT NULL,
	"book_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"file_id" integer NOT NULL,
	"external_id" text NOT NULL,
	"occurred_on" date NOT NULL,
	"occurred_at" timestamp with time zone,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"name" text NOT NULL,
	"descriptor_key" text NOT NULL,
	"description" text NOT NULL,
	"payment_method" text,
	"party_id" integer,
	"financial_category_id" integer,
	"counter_account_id" integer,
	"settlement_group" text,
	"promise" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"ignore_reason" text,
	CONSTRAINT "receipt_movements_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "receipt_movements_amount_positive" CHECK ("receipt_movements"."amount" > 0),
	CONSTRAINT "receipt_movements_currency_check" CHECK ("receipt_movements"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "receipt_movements_payment_method_check" CHECK ("receipt_movements"."payment_method" is null or "receipt_movements"."payment_method" in ('PIX', 'BOLETO', 'TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD')),
	CONSTRAINT "receipt_movements_status_check" CHECK ("receipt_movements"."status" in ('PENDING', 'POSTED', 'IGNORED') and ("receipt_movements"."status" = 'IGNORED') = ("receipt_movements"."ignore_reason" is not null)),
	CONSTRAINT "receipt_movements_mapping_check" CHECK ("receipt_movements"."counter_account_id" is null or ("receipt_movements"."party_id" is null and "receipt_movements"."financial_category_id" is null and "receipt_movements"."counter_account_id" <> "receipt_movements"."account_id")),
	CONSTRAINT "receipt_movements_settlement_group_check" CHECK ("receipt_movements"."settlement_group" is null or ("receipt_movements"."financial_category_id" is null and "receipt_movements"."counter_account_id" is null)),
	CONSTRAINT "receipt_movements_promise_check" CHECK (true)
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"key" text,
	"method" text,
	"amount" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"reference_month" date NOT NULL,
	"due_on" date,
	"due_at" timestamp with time zone,
	"paid_on" date,
	"paid_at" timestamp with time zone,
	CONSTRAINT "receipts_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "receipts_book_id_id_currency_uk" UNIQUE("book_id","id","currency"),
	CONSTRAINT "receipts_amount_nonnegative" CHECK ("receipts"."amount" >= 0),
	CONSTRAINT "receipts_currency_check" CHECK ("receipts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "receipts_method_check" CHECK ("receipts"."method" is null or "receipts"."method" in ('PIX', 'BOLETO', 'TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD'))
);
--> statement-breakpoint
CREATE TABLE "revenue_movement_descriptors" (
	"book_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"descriptor_key" text NOT NULL,
	"component" text NOT NULL,
	"name" text NOT NULL,
	"party_id" integer,
	"financial_category_id" integer,
	"settlement_group" text,
	"settles_method_key" text,
	"received_account_id" integer,
	CONSTRAINT "revenue_movement_descriptors_pk" PRIMARY KEY("book_id","account_id","descriptor_key"),
	CONSTRAINT "revenue_movement_descriptors_component_check" CHECK ("revenue_movement_descriptors"."component" in ('GROSS', 'DISCOUNT', 'FEE', 'ACQUIRER_FEE')),
	CONSTRAINT "revenue_movement_descriptors_settlement_check" CHECK (case "revenue_movement_descriptors"."component"
        when 'ACQUIRER_FEE' then ("revenue_movement_descriptors"."settlement_group" is null) = ("revenue_movement_descriptors"."settles_method_key" is null) and "revenue_movement_descriptors"."received_account_id" is null
        when 'GROSS' then "revenue_movement_descriptors"."settles_method_key" is null and ("revenue_movement_descriptors"."settlement_group" is null or "revenue_movement_descriptors"."received_account_id" is null)
        else "revenue_movement_descriptors"."settlement_group" is null and "revenue_movement_descriptors"."settles_method_key" is null and "revenue_movement_descriptors"."received_account_id" is null end)
);
--> statement-breakpoint
CREATE TABLE "revenue_movement_links" (
	"book_id" integer NOT NULL,
	"movement_id" integer NOT NULL,
	"component" text NOT NULL,
	"external_key" text NOT NULL,
	"statement_id" text NOT NULL,
	"revenue_key" text NOT NULL,
	"revenue_id" integer NOT NULL,
	CONSTRAINT "revenue_movement_links_pk" PRIMARY KEY("book_id","movement_id","component"),
	CONSTRAINT "revenue_movement_links_component_check" CHECK ("revenue_movement_links"."component" in ('GROSS', 'DISCOUNT', 'FEE', 'ACQUIRER_FEE'))
);
--> statement-breakpoint
CREATE TABLE "revenue_movement_receipts" (
	"book_id" integer NOT NULL,
	"movement_id" integer NOT NULL,
	"receipt_id" integer NOT NULL,
	"own" boolean DEFAULT false NOT NULL,
	CONSTRAINT "revenue_movement_receipts_pk" PRIMARY KEY("book_id","movement_id","receipt_id")
);
--> statement-breakpoint
CREATE TABLE "revenue_movements" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"file_id" integer NOT NULL,
	"external_id" text NOT NULL,
	"occurred_on" date NOT NULL,
	"name" text NOT NULL,
	"method_key" text NOT NULL,
	"quantity" integer NOT NULL,
	"gross" bigint NOT NULL,
	"discount" bigint NOT NULL,
	"fee" bigint NOT NULL,
	"acquirer_fee" bigint NOT NULL,
	"gross_recognized" boolean NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"ignore_reason" text,
	CONSTRAINT "revenue_movements_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "revenue_movements_amounts_check" CHECK ("revenue_movements"."gross" > 0 and "revenue_movements"."discount" >= 0 and "revenue_movements"."fee" >= 0 and "revenue_movements"."acquirer_fee" >= 0 and "revenue_movements"."quantity" >= 0 and "revenue_movements"."amount" = "revenue_movements"."gross" - "revenue_movements"."discount" + "revenue_movements"."fee" - "revenue_movements"."acquirer_fee"),
	CONSTRAINT "revenue_movements_currency_check" CHECK ("revenue_movements"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "revenue_movements_status_check" CHECK ("revenue_movements"."status" in ('PENDING', 'POSTED', 'IGNORED') and ("revenue_movements"."status" = 'IGNORED') = ("revenue_movements"."ignore_reason" is not null))
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
	"voided_at" timestamp with time zone,
	"voided_by" text,
	"void_reason" text,
	CONSTRAINT "revenue_settlements_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "revenue_settlements_amount_nonzero" CHECK ("revenue_settlements"."amount" <> 0),
	CONSTRAINT "revenue_settlements_currency_check" CHECK ("revenue_settlements"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "revenues" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"key" text NOT NULL,
	"party_id" integer NOT NULL,
	"financial_category_id" integer NOT NULL,
	"name" text,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"reference_month" date NOT NULL,
	"occurred_on" date,
	"occurred_at" timestamp with time zone,
	CONSTRAINT "revenues_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "revenues_book_id_id_currency_uk" UNIQUE("book_id","id","currency"),
	CONSTRAINT "revenues_amount_nonzero" CHECK ("revenues"."amount" <> 0),
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
	"occurred_on" date,
	"occurred_at" timestamp with time zone,
	CONSTRAINT "transfers_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "transfers_amount_positive" CHECK ("transfers"."amount" > 0),
	CONSTRAINT "transfers_currency_check" CHECK ("transfers"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" integer,
	CONSTRAINT "product_categories_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "product_categories_self_parent_check" CHECK ("product_categories"."parent_id" is null or "product_categories"."parent_id" <> "product_categories"."id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"product_category_id" integer NOT NULL,
	"cost_override" bigint,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "products_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "products_cost_override_nonnegative" CHECK ("products"."cost_override" is null or "products"."cost_override" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sale_consumers" (
	"book_id" integer NOT NULL,
	"movement_type" text NOT NULL,
	"importer_id" text NOT NULL,
	"set_by" text NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_consumers_pk" PRIMARY KEY("book_id","movement_type"),
	CONSTRAINT "sale_consumers_type_check" CHECK ("sale_consumers"."movement_type" ~ '^[a-z][a-z0-9-]{0,49}$')
);
--> statement-breakpoint
CREATE TABLE "sale_files" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"movement_type" text NOT NULL,
	"importer_id" text NOT NULL,
	"importer_version" integer NOT NULL,
	"importer_fingerprint" text NOT NULL,
	"content_sha256" text NOT NULL,
	"source_key" text NOT NULL,
	"line_count" integer NOT NULL,
	"new_count" integer NOT NULL,
	"imported_by" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_files_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "sale_files_sha256_check" CHECK ("sale_files"."content_sha256" ~ '^[0-9a-f]{64}$' and "sale_files"."importer_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "sale_movement_descriptors" (
	"book_id" integer NOT NULL,
	"descriptor_key" text NOT NULL,
	"name" text NOT NULL,
	"product_id" integer,
	CONSTRAINT "sale_movement_descriptors_pk" PRIMARY KEY("book_id","descriptor_key")
);
--> statement-breakpoint
CREATE TABLE "sale_movement_links" (
	"book_id" integer NOT NULL,
	"movement_id" integer NOT NULL,
	"external_key" text NOT NULL,
	"sale_key" text NOT NULL,
	"sale_id" integer NOT NULL,
	CONSTRAINT "sale_movement_links_pk" PRIMARY KEY("book_id","movement_id")
);
--> statement-breakpoint
CREATE TABLE "sale_movements" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"file_id" integer NOT NULL,
	"external_id" text NOT NULL,
	"business_date" date NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"provider_category" text,
	"descriptor_key" text NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"revenue" bigint NOT NULL,
	"cost" bigint,
	"currency" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"ignore_reason" text,
	CONSTRAINT "sale_movements_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "sale_movements_quantity_positive" CHECK ("sale_movements"."quantity" > 0),
	CONSTRAINT "sale_movements_revenue_nonnegative" CHECK ("sale_movements"."revenue" >= 0),
	CONSTRAINT "sale_movements_cost_nonnegative" CHECK ("sale_movements"."cost" is null or "sale_movements"."cost" >= 0),
	CONSTRAINT "sale_movements_currency_check" CHECK ("sale_movements"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "sale_movements_status_check" CHECK ("sale_movements"."status" in ('PENDING', 'POSTED', 'IGNORED') and ("sale_movements"."status" = 'IGNORED') = ("sale_movements"."ignore_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" serial NOT NULL,
	"book_id" integer NOT NULL,
	"business_date" date NOT NULL,
	"currency" text NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"revenue" bigint NOT NULL,
	"unit_cost" bigint,
	"cost" bigint,
	"cost_source" text NOT NULL,
	CONSTRAINT "sales_book_id_id_pk" PRIMARY KEY("book_id","id"),
	CONSTRAINT "sales_revenue_nonnegative" CHECK ("sales"."revenue" >= 0),
	CONSTRAINT "sales_quantity_positive" CHECK ("sales"."quantity" > 0),
	CONSTRAINT "sales_currency_check" CHECK ("sales"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "sales_cost_source_check" CHECK ("sales"."cost_source" in ('SALE', 'CATALOG', 'MISSING')),
	CONSTRAINT "sales_cost_missing_check" CHECK (("sales"."cost_source" = 'MISSING') = ("sales"."cost" is null))
);
--> statement-breakpoint
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_book_id_operator_fk" FOREIGN KEY ("book_id","delegated_operator") REFERENCES "public"."book_members"("book_id","user_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "book_members" ADD CONSTRAINT "book_members_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "book_members" ADD CONSTRAINT "book_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "account_cycles" ADD CONSTRAINT "account_cycles_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "account_cycles" ADD CONSTRAINT "account_cycles_book_id_account_id_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_book_id_institution_id_fk" FOREIGN KEY ("book_id","institution_id") REFERENCES "public"."institutions"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "card_movement_descriptors" ADD CONSTRAINT "card_movement_descriptors_account_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "card_movement_descriptors" ADD CONSTRAINT "card_movement_descriptors_party_fk" FOREIGN KEY ("book_id","party_id") REFERENCES "public"."parties"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "card_movement_descriptors" ADD CONSTRAINT "card_movement_descriptors_financial_category_fk" FOREIGN KEY ("book_id","financial_category_id") REFERENCES "public"."financial_categories"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "card_movement_descriptors" ADD CONSTRAINT "card_movement_descriptors_counter_account_fk" FOREIGN KEY ("book_id","counter_account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "card_movement_expenses" ADD CONSTRAINT "card_movement_expenses_account_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "card_movement_expenses" ADD CONSTRAINT "card_movement_expenses_expense_fk" FOREIGN KEY ("book_id","expense_id") REFERENCES "public"."expenses"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "card_movement_payments" ADD CONSTRAINT "card_movement_payments_expense_link_fk" FOREIGN KEY ("book_id","account_id","expense_key") REFERENCES "public"."card_movement_expenses"("book_id","account_id","expense_key") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "card_movement_payments" ADD CONSTRAINT "card_movement_payments_payment_fk" FOREIGN KEY ("book_id","payment_id") REFERENCES "public"."payments"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "card_movement_payments" ADD CONSTRAINT "card_movement_payments_settlement_fk" FOREIGN KEY ("book_id","settlement_id") REFERENCES "public"."expense_settlements"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "card_movement_payments" ADD CONSTRAINT "card_movement_payments_movement_fk" FOREIGN KEY ("book_id","movement_id") REFERENCES "public"."card_movements"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "card_movement_transfers" ADD CONSTRAINT "card_movement_transfers_movement_fk" FOREIGN KEY ("book_id","movement_id") REFERENCES "public"."card_movements"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "card_movement_transfers" ADD CONSTRAINT "card_movement_transfers_account_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "card_movement_transfers" ADD CONSTRAINT "card_movement_transfers_transfer_fk" FOREIGN KEY ("book_id","transfer_id") REFERENCES "public"."transfers"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "card_movements" ADD CONSTRAINT "card_movements_account_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "card_movements" ADD CONSTRAINT "card_movements_file_fk" FOREIGN KEY ("book_id","file_id") REFERENCES "public"."movement_files"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "card_movements" ADD CONSTRAINT "card_movements_descriptor_fk" FOREIGN KEY ("book_id","account_id","descriptor_key") REFERENCES "public"."card_movement_descriptors"("book_id","account_id","descriptor_key") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "card_movements" ADD CONSTRAINT "card_movements_party_fk" FOREIGN KEY ("book_id","party_id") REFERENCES "public"."parties"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "card_movements" ADD CONSTRAINT "card_movements_financial_category_fk" FOREIGN KEY ("book_id","financial_category_id") REFERENCES "public"."financial_categories"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "card_movements" ADD CONSTRAINT "card_movements_counter_account_fk" FOREIGN KEY ("book_id","counter_account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_settlements" ADD CONSTRAINT "expense_settlements_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_settlements" ADD CONSTRAINT "expense_settlements_book_id_expense_id_fk" FOREIGN KEY ("book_id","expense_id","currency") REFERENCES "public"."expenses"("book_id","id","currency") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_settlements" ADD CONSTRAINT "expense_settlements_book_id_payment_id_fk" FOREIGN KEY ("book_id","payment_id","currency") REFERENCES "public"."payments"("book_id","id","currency") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_book_id_party_id_fk" FOREIGN KEY ("book_id","party_id") REFERENCES "public"."parties"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_book_id_financial_category_id_fk" FOREIGN KEY ("book_id","financial_category_id") REFERENCES "public"."financial_categories"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "financial_categories" ADD CONSTRAINT "financial_categories_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "financial_categories" ADD CONSTRAINT "financial_categories_book_id_parent_id_fk" FOREIGN KEY ("book_id","parent_id") REFERENCES "public"."financial_categories"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "institutions" ADD CONSTRAINT "institutions_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "movement_consumers" ADD CONSTRAINT "movement_consumers_account_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "movement_files" ADD CONSTRAINT "movement_files_account_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_movement_descriptors" ADD CONSTRAINT "payment_movement_descriptors_account_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_movement_descriptors" ADD CONSTRAINT "payment_movement_descriptors_party_fk" FOREIGN KEY ("book_id","party_id") REFERENCES "public"."parties"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_movement_descriptors" ADD CONSTRAINT "payment_movement_descriptors_financial_category_fk" FOREIGN KEY ("book_id","financial_category_id") REFERENCES "public"."financial_categories"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_movement_descriptors" ADD CONSTRAINT "payment_movement_descriptors_counter_account_fk" FOREIGN KEY ("book_id","counter_account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_movement_links" ADD CONSTRAINT "payment_movement_links_movement_fk" FOREIGN KEY ("book_id","movement_id") REFERENCES "public"."payment_movements"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_movement_links" ADD CONSTRAINT "payment_movement_links_transfer_fk" FOREIGN KEY ("book_id","transfer_id") REFERENCES "public"."transfers"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_movement_links" ADD CONSTRAINT "payment_movement_links_expense_fk" FOREIGN KEY ("book_id","expense_id") REFERENCES "public"."expenses"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_movement_links" ADD CONSTRAINT "payment_movement_links_payment_fk" FOREIGN KEY ("book_id","payment_id") REFERENCES "public"."payments"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_movements" ADD CONSTRAINT "payment_movements_account_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_movements" ADD CONSTRAINT "payment_movements_file_fk" FOREIGN KEY ("book_id","file_id") REFERENCES "public"."movement_files"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_movements" ADD CONSTRAINT "payment_movements_descriptor_fk" FOREIGN KEY ("book_id","account_id","descriptor_key") REFERENCES "public"."payment_movement_descriptors"("book_id","account_id","descriptor_key") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_movements" ADD CONSTRAINT "payment_movements_party_fk" FOREIGN KEY ("book_id","party_id") REFERENCES "public"."parties"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_movements" ADD CONSTRAINT "payment_movements_financial_category_fk" FOREIGN KEY ("book_id","financial_category_id") REFERENCES "public"."financial_categories"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_movements" ADD CONSTRAINT "payment_movements_counter_account_fk" FOREIGN KEY ("book_id","counter_account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_book_id_account_id_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receipt_movement_descriptors" ADD CONSTRAINT "receipt_movement_descriptors_account_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receipt_movement_descriptors" ADD CONSTRAINT "receipt_movement_descriptors_party_fk" FOREIGN KEY ("book_id","party_id") REFERENCES "public"."parties"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receipt_movement_descriptors" ADD CONSTRAINT "receipt_movement_descriptors_financial_category_fk" FOREIGN KEY ("book_id","financial_category_id") REFERENCES "public"."financial_categories"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receipt_movement_descriptors" ADD CONSTRAINT "receipt_movement_descriptors_counter_account_fk" FOREIGN KEY ("book_id","counter_account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receipt_movement_links" ADD CONSTRAINT "receipt_movement_links_movement_fk" FOREIGN KEY ("book_id","movement_id") REFERENCES "public"."receipt_movements"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receipt_movement_links" ADD CONSTRAINT "receipt_movement_links_transfer_fk" FOREIGN KEY ("book_id","transfer_id") REFERENCES "public"."transfers"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receipt_movement_links" ADD CONSTRAINT "receipt_movement_links_revenue_fk" FOREIGN KEY ("book_id","revenue_id") REFERENCES "public"."revenues"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receipt_movement_links" ADD CONSTRAINT "receipt_movement_links_receipt_fk" FOREIGN KEY ("book_id","receipt_id") REFERENCES "public"."receipts"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receipt_movements" ADD CONSTRAINT "receipt_movements_account_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receipt_movements" ADD CONSTRAINT "receipt_movements_file_fk" FOREIGN KEY ("book_id","file_id") REFERENCES "public"."movement_files"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receipt_movements" ADD CONSTRAINT "receipt_movements_descriptor_fk" FOREIGN KEY ("book_id","account_id","descriptor_key") REFERENCES "public"."receipt_movement_descriptors"("book_id","account_id","descriptor_key") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receipt_movements" ADD CONSTRAINT "receipt_movements_party_fk" FOREIGN KEY ("book_id","party_id") REFERENCES "public"."parties"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receipt_movements" ADD CONSTRAINT "receipt_movements_financial_category_fk" FOREIGN KEY ("book_id","financial_category_id") REFERENCES "public"."financial_categories"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receipt_movements" ADD CONSTRAINT "receipt_movements_counter_account_fk" FOREIGN KEY ("book_id","counter_account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_book_id_account_id_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "revenue_movement_descriptors" ADD CONSTRAINT "revenue_movement_descriptors_account_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "revenue_movement_descriptors" ADD CONSTRAINT "revenue_movement_descriptors_party_fk" FOREIGN KEY ("book_id","party_id") REFERENCES "public"."parties"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "revenue_movement_descriptors" ADD CONSTRAINT "revenue_movement_descriptors_financial_category_fk" FOREIGN KEY ("book_id","financial_category_id") REFERENCES "public"."financial_categories"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "revenue_movement_descriptors" ADD CONSTRAINT "revenue_movement_descriptors_received_account_fk" FOREIGN KEY ("book_id","received_account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "revenue_movement_links" ADD CONSTRAINT "revenue_movement_links_movement_fk" FOREIGN KEY ("book_id","movement_id") REFERENCES "public"."revenue_movements"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "revenue_movement_links" ADD CONSTRAINT "revenue_movement_links_revenue_fk" FOREIGN KEY ("book_id","revenue_id") REFERENCES "public"."revenues"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "revenue_movement_receipts" ADD CONSTRAINT "revenue_movement_receipts_movement_fk" FOREIGN KEY ("book_id","movement_id") REFERENCES "public"."revenue_movements"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "revenue_movement_receipts" ADD CONSTRAINT "revenue_movement_receipts_receipt_fk" FOREIGN KEY ("book_id","receipt_id") REFERENCES "public"."receipts"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "revenue_movements" ADD CONSTRAINT "revenue_movements_account_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "revenue_movements" ADD CONSTRAINT "revenue_movements_file_fk" FOREIGN KEY ("book_id","file_id") REFERENCES "public"."movement_files"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "revenue_settlements" ADD CONSTRAINT "revenue_settlements_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "revenue_settlements" ADD CONSTRAINT "revenue_settlements_book_id_revenue_id_fk" FOREIGN KEY ("book_id","revenue_id","currency") REFERENCES "public"."revenues"("book_id","id","currency") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "revenue_settlements" ADD CONSTRAINT "revenue_settlements_book_id_receipt_id_fk" FOREIGN KEY ("book_id","receipt_id","currency") REFERENCES "public"."receipts"("book_id","id","currency") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "revenues" ADD CONSTRAINT "revenues_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "revenues" ADD CONSTRAINT "revenues_book_id_party_id_fk" FOREIGN KEY ("book_id","party_id") REFERENCES "public"."parties"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "revenues" ADD CONSTRAINT "revenues_book_id_financial_category_id_fk" FOREIGN KEY ("book_id","financial_category_id") REFERENCES "public"."financial_categories"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_book_id_source_account_fk" FOREIGN KEY ("book_id","source_account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_book_id_destination_account_fk" FOREIGN KEY ("book_id","destination_account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_book_id_parent_id_fk" FOREIGN KEY ("book_id","parent_id") REFERENCES "public"."product_categories"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_book_id_product_category_id_fk" FOREIGN KEY ("book_id","product_category_id") REFERENCES "public"."product_categories"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sale_consumers" ADD CONSTRAINT "sale_consumers_book_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sale_files" ADD CONSTRAINT "sale_files_book_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sale_movement_descriptors" ADD CONSTRAINT "sale_movement_descriptors_book_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sale_movement_descriptors" ADD CONSTRAINT "sale_movement_descriptors_product_fk" FOREIGN KEY ("book_id","product_id") REFERENCES "public"."products"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sale_movement_links" ADD CONSTRAINT "sale_movement_links_movement_fk" FOREIGN KEY ("book_id","movement_id") REFERENCES "public"."sale_movements"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sale_movement_links" ADD CONSTRAINT "sale_movement_links_sale_fk" FOREIGN KEY ("book_id","sale_id") REFERENCES "public"."sales"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sale_movements" ADD CONSTRAINT "sale_movements_file_fk" FOREIGN KEY ("book_id","file_id") REFERENCES "public"."sale_files"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sale_movements" ADD CONSTRAINT "sale_movements_descriptor_fk" FOREIGN KEY ("book_id","descriptor_key") REFERENCES "public"."sale_movement_descriptors"("book_id","descriptor_key") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_book_id_product_id_fk" FOREIGN KEY ("book_id","product_id") REFERENCES "public"."products"("book_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "books_key_uk" ON "books" USING btree ("key");
--> statement-breakpoint
CREATE UNIQUE INDEX "account_cycles_book_account_month_uk" ON "account_cycles" USING btree ("book_id","account_id","reference_month");
--> statement-breakpoint
CREATE INDEX "account_cycles_book_account_window_idx" ON "account_cycles" USING btree ("book_id","account_id","starts_on","ends_on");
--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_book_id_key_uk" ON "accounts" USING btree ("book_id","key");
--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_book_institution_number_uk" ON "accounts" USING btree ("book_id","institution_id","number");
--> statement-breakpoint
CREATE UNIQUE INDEX "card_movement_expenses_expense_uk" ON "card_movement_expenses" USING btree ("book_id","expense_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "card_movement_payments_installment_uk" ON "card_movement_payments" USING btree ("book_id","account_id","expense_key","installment_number");
--> statement-breakpoint
CREATE UNIQUE INDEX "card_movement_payments_settlement_uk" ON "card_movement_payments" USING btree ("book_id","settlement_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "card_movement_transfers_transfer_uk" ON "card_movement_transfers" USING btree ("book_id","transfer_id");
--> statement-breakpoint
CREATE INDEX "card_movement_transfers_statement_key_idx" ON "card_movement_transfers" USING btree ("book_id","statement_key");
--> statement-breakpoint
CREATE INDEX "card_movement_transfers_external_key_idx" ON "card_movement_transfers" USING btree ("book_id","external_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "card_movements_statement_uk" ON "card_movements" USING btree ("book_id","account_id","statement_id");
--> statement-breakpoint
CREATE INDEX "card_movements_external_idx" ON "card_movements" USING btree ("book_id","account_id","external_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "card_movements_payment_key_uk" ON "card_movements" USING btree ("book_id","account_id","payment_key");
--> statement-breakpoint
CREATE INDEX "card_movements_expense_key_idx" ON "card_movements" USING btree ("book_id","account_id","expense_key");
--> statement-breakpoint
CREATE INDEX "card_movements_status_idx" ON "card_movements" USING btree ("book_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_book_id_key_uk" ON "expenses" USING btree ("book_id","key");
--> statement-breakpoint
CREATE INDEX "expenses_book_id_reference_month_idx" ON "expenses" USING btree ("book_id","reference_month");
--> statement-breakpoint
CREATE INDEX "financial_categories_book_id_parent_id_idx" ON "financial_categories" USING btree ("book_id","parent_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "institutions_book_id_key_uk" ON "institutions" USING btree ("book_id","key");
--> statement-breakpoint
CREATE UNIQUE INDEX "movement_files_content_uk" ON "movement_files" USING btree ("book_id","account_id","importer_fingerprint","content_sha256");
--> statement-breakpoint
CREATE UNIQUE INDEX "parties_book_id_key_uk" ON "parties" USING btree ("book_id","key");
--> statement-breakpoint
CREATE INDEX "payment_movement_links_statement_key_idx" ON "payment_movement_links" USING btree ("book_id","statement_key");
--> statement-breakpoint
CREATE INDEX "payment_movement_links_movement_idx" ON "payment_movement_links" USING btree ("book_id","movement_id");
--> statement-breakpoint
CREATE INDEX "payment_movement_links_external_key_idx" ON "payment_movement_links" USING btree ("book_id","external_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_movement_links_expense_key_uk" ON "payment_movement_links" USING btree ("book_id","expense_key");
--> statement-breakpoint
CREATE INDEX "payment_movement_links_payment_key_idx" ON "payment_movement_links" USING btree ("book_id","payment_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_movements_external_uk" ON "payment_movements" USING btree ("book_id","account_id","external_id");
--> statement-breakpoint
CREATE INDEX "payment_movements_status_idx" ON "payment_movements" USING btree ("book_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "payments_book_id_key_uk" ON "payments" USING btree ("book_id","key");
--> statement-breakpoint
CREATE INDEX "payments_book_id_reference_month_idx" ON "payments" USING btree ("book_id","reference_month");
--> statement-breakpoint
CREATE INDEX "receipt_movement_links_statement_key_idx" ON "receipt_movement_links" USING btree ("book_id","statement_key");
--> statement-breakpoint
CREATE INDEX "receipt_movement_links_movement_idx" ON "receipt_movement_links" USING btree ("book_id","movement_id");
--> statement-breakpoint
CREATE INDEX "receipt_movement_links_external_key_idx" ON "receipt_movement_links" USING btree ("book_id","external_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_movement_links_revenue_key_uk" ON "receipt_movement_links" USING btree ("book_id","revenue_key");
--> statement-breakpoint
CREATE INDEX "receipt_movement_links_receipt_key_idx" ON "receipt_movement_links" USING btree ("book_id","receipt_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_movements_external_uk" ON "receipt_movements" USING btree ("book_id","account_id","external_id");
--> statement-breakpoint
CREATE INDEX "receipt_movements_status_idx" ON "receipt_movements" USING btree ("book_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_book_id_key_uk" ON "receipts" USING btree ("book_id","key");
--> statement-breakpoint
CREATE INDEX "receipts_book_id_reference_month_idx" ON "receipts" USING btree ("book_id","reference_month");
--> statement-breakpoint
CREATE UNIQUE INDEX "revenue_movement_links_revenue_uk" ON "revenue_movement_links" USING btree ("book_id","revenue_id");
--> statement-breakpoint
CREATE INDEX "revenue_movement_links_external_key_idx" ON "revenue_movement_links" USING btree ("book_id","external_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "revenue_movement_links_statement_uk" ON "revenue_movement_links" USING btree ("book_id","statement_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "revenue_movement_links_revenue_key_uk" ON "revenue_movement_links" USING btree ("book_id","revenue_key");
--> statement-breakpoint
CREATE INDEX "revenue_movement_receipts_receipt_idx" ON "revenue_movement_receipts" USING btree ("book_id","receipt_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "revenue_movements_external_uk" ON "revenue_movements" USING btree ("book_id","account_id","external_id");
--> statement-breakpoint
CREATE INDEX "revenue_movements_status_idx" ON "revenue_movements" USING btree ("book_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "revenues_book_id_key_uk" ON "revenues" USING btree ("book_id","key");
--> statement-breakpoint
CREATE INDEX "revenues_book_id_reference_month_idx" ON "revenues" USING btree ("book_id","reference_month");
--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_book_id_key_uk" ON "transfers" USING btree ("book_id","key");
--> statement-breakpoint
CREATE INDEX "transfers_book_id_reference_month_idx" ON "transfers" USING btree ("book_id","reference_month");
--> statement-breakpoint
CREATE UNIQUE INDEX "product_categories_book_id_key_uk" ON "product_categories" USING btree ("book_id","key");
--> statement-breakpoint
CREATE UNIQUE INDEX "products_book_id_key_uk" ON "products" USING btree ("book_id","key");
--> statement-breakpoint
CREATE UNIQUE INDEX "sale_files_content_uk" ON "sale_files" USING btree ("book_id","importer_fingerprint","content_sha256");
--> statement-breakpoint
CREATE UNIQUE INDEX "sale_movement_links_sale_uk" ON "sale_movement_links" USING btree ("book_id","sale_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sale_movement_links_sale_key_uk" ON "sale_movement_links" USING btree ("book_id","sale_key");
--> statement-breakpoint
CREATE INDEX "sale_movement_links_external_key_idx" ON "sale_movement_links" USING btree ("book_id","external_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "sale_movements_external_uk" ON "sale_movements" USING btree ("book_id","external_id");
--> statement-breakpoint
CREATE INDEX "sale_movements_status_idx" ON "sale_movements" USING btree ("book_id","status");
--> statement-breakpoint
CREATE INDEX "sales_business_date_idx" ON "sales" USING btree ("book_id","business_date");
--> statement-breakpoint
-- module: finance
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
--> statement-breakpoint
-- module: sales
-- sales: invariants a CHECK cannot express.
--
-- Appended to the generated init after finance's (ADR 11).

-- Product categories nest one level, like financial categories: a category
-- with a group may not itself be a group, and a group may not move inside one.
CREATE OR REPLACE FUNCTION product_category_depth() RETURNS trigger AS $$
DECLARE
  parent_parent integer;
  children integer;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT parent_id INTO parent_parent
    FROM product_categories
   WHERE book_id = NEW.book_id AND id = NEW.parent_id;

  IF parent_parent IS NOT NULL THEN
    RAISE EXCEPTION
      'product categories nest one level: the chosen group is already inside a group'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO children
    FROM product_categories WHERE book_id = NEW.book_id AND parent_id = NEW.id;
  IF children > 0 THEN
    RAISE EXCEPTION
      'that product category is a group; it cannot move inside another group'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS product_category_depth_trigger ON product_categories;
--> statement-breakpoint
CREATE TRIGGER product_category_depth_trigger
  BEFORE INSERT OR UPDATE ON product_categories
  FOR EACH ROW EXECUTE FUNCTION product_category_depth();
--> statement-breakpoint
-- Sales evidence (ADR 21): a link joins a movement to the line that says
-- what it printed, on its day, in its currency, under the movement's key.
CREATE OR REPLACE FUNCTION sale_movement_link_matches() RETURNS trigger AS $$
DECLARE
  movement_row sale_movements%ROWTYPE;
  line_row sales%ROWTYPE;
BEGIN
  SELECT * INTO movement_row FROM sale_movements
   WHERE book_id = NEW.book_id AND id = NEW.movement_id;
  SELECT * INTO line_row FROM sales
   WHERE book_id = NEW.book_id AND id = NEW.sale_id;
  IF movement_row.id IS NULL OR line_row.id IS NULL THEN
    RETURN NEW; -- the foreign keys reject this row on their own
  END IF;
  IF NEW.external_key <> movement_row.external_id
     OR NEW.sale_key <> movement_row.external_id || '-sale' THEN
    RAISE EXCEPTION 'a sale link carries its movement''s external key and <external key>-sale'
      USING ERRCODE = '23514';
  END IF;
  IF movement_row.business_date <> line_row.business_date
     OR movement_row.quantity <> line_row.quantity
     OR movement_row.revenue <> line_row.revenue
     OR movement_row.currency <> line_row.currency THEN
    RAISE EXCEPTION 'a sale line says what its movement printed'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER sale_movement_links_match
  BEFORE INSERT OR UPDATE ON sale_movement_links
  FOR EACH ROW EXECUTE FUNCTION sale_movement_link_matches();
--> statement-breakpoint
-- A sale movement is POSTED exactly when it has its link. At commit: posting
-- writes the link and the status in either order.
CREATE OR REPLACE FUNCTION sale_movement_posted_link() RETURNS trigger AS $$
DECLARE
  row_data jsonb := to_jsonb(COALESCE(NEW, OLD));
  book integer := (row_data ->> 'book_id')::integer;
  movement integer := (row_data ->> CASE WHEN TG_TABLE_NAME = 'sale_movements' THEN 'id' ELSE 'movement_id' END)::integer;
  movement_status text;
  link_count integer;
BEGIN
  SELECT status INTO movement_status FROM sale_movements WHERE book_id = book AND id = movement;
  IF movement_status IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT count(*) INTO link_count FROM sale_movement_links WHERE book_id = book AND movement_id = movement;
  IF (movement_status = 'POSTED') <> (link_count = 1) THEN
    RAISE EXCEPTION 'sale movement % is % and has % links', movement, movement_status, link_count
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER sale_movements_posted_link
  AFTER INSERT OR UPDATE ON sale_movements
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION sale_movement_posted_link();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER sale_movement_links_posted_link
  AFTER INSERT OR UPDATE OR DELETE ON sale_movement_links
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION sale_movement_posted_link();
--> statement-breakpoint
-- A sale line exists only as what a movement became: one without its link
-- is refused at commit.
CREATE OR REPLACE FUNCTION sale_line_has_link() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM sales WHERE book_id = NEW.book_id AND id = NEW.id)
     AND NOT EXISTS (
       SELECT 1 FROM sale_movement_links WHERE book_id = NEW.book_id AND sale_id = NEW.id
     ) THEN
    RAISE EXCEPTION 'sale line % is linked to no movement', NEW.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER sales_have_link
  AFTER INSERT OR UPDATE ON sales
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION sale_line_has_link();
