# ADR 1: PostgreSQL Is the Source of Truth

**Status:** Accepted (0.1.0)

## Context

Lastro keeps money for a person, a family or a business. Its state must survive restarts, be backed up with one tool and be checked by rules no caller can skip.

## Decision

- All durable state lives in PostgreSQL 16. There is no other store: no cache, no queue, no document database.
- Rules a caller could get around if only the application held them (settlement caps, signs, posting states) are database constraints and triggers.
- The schema ships as one generated init file, `packages/host/drizzle/0000_init.sql`, assembled from every module's tables and triggers in module order. A changed schema is deployed by recreating the database; nothing is migrated.

## Consequences

- A backup is one `pg_dump`. A schema change means recreating the database, so data is entered again or imported again; the runbook says how.
