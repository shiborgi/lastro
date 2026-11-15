/**
 * The database handle a `Scope` carries, as the modules' db code sees it.
 *
 * Application code treats `scope.handle` as opaque. Only a module's `db/`
 * folder opens it, through `dbOf`.
 */
import {
  InvalidRequestError,
  type Scope,
  type UserContext,
} from "@lastro/kernel";
import type { PgDatabase } from "drizzle-orm/pg-core";

// biome-ignore lint/suspicious/noExplicitAny: a connection and a transaction of any driver both fit
export type Db = PgDatabase<any, any, any>;

export function dbOf(scope: Scope<UserContext>): Db {
  return scope.handle as Db;
}

/** A serial id as the database holds it; ids are decimal text everywhere else. */
export function idNumber(value: string, field = "id"): number {
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new InvalidRequestError(`${field} must be a positive integer`);
  }
  return Number(value);
}
