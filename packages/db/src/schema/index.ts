/**
 * The PostgreSQL schema, split by aggregate.
 *
 * The export order here is load-bearing: drizzle-kit emits statements in the
 * order it discovers tables, and `bun run db:regenerate` has to keep producing
 * a byte-identical `drizzle/0000_init.sql`.
 */
export * from "./auth";
export * from "./books";
export * from "./catalog";
export * from "./financial";
export * from "./audit";
export * from "./movements";
