/**
 * The parsers this module ships, one folder per flow (docs/flows/<flow-id>.md).
 * Provider names live here and in the flow documents only (ADR 13).
 */
import type { MovementImporter } from "../application/importer";
import { c6Account } from "./c6-account";
import { c6Card } from "./c6-card";
import { nubankAccount } from "./nubank-account";
import { stoneAccount } from "./stone-account";
import { stonePayouts } from "./stone-payouts";
import { stoneSales } from "./stone-sales";
import { yoogaPayments } from "./yooga-payments";

export const movementImporters: readonly MovementImporter[] = [
  nubankAccount,
  c6Card,
  c6Account,
  yoogaPayments,
  stoneSales,
  stoneAccount,
  stonePayouts,
];
