/**
 * The persistence port, split by aggregate.
 *
 * Every member is required. The application calls these directly; a repository
 * that cannot answer one does not typecheck, which is the difference between
 * this and the optional-slot shape it replaces — that one deferred the same
 * question to a runtime throw on the first call.
 */
import type { CatalogRepository } from "./catalog";
import type { ExpenseRepository } from "./expenses";
import type { MovementRepository } from "./movements";
import type { RevenueRepository } from "./revenues";
import type { TransferRepository } from "./transfers";

export type { CatalogRepository } from "./catalog";
export type { ExpenseRepository } from "./expenses";
export type { MovementRepository } from "./movements";
export type { RevenueRepository } from "./revenues";
export type { TransferRepository } from "./transfers";

export type ApplicationRepository = CatalogRepository &
  ExpenseRepository &
  RevenueRepository &
  TransferRepository &
  MovementRepository;
