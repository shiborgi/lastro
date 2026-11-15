/**
 * The parsers this module ships, one folder per flow (docs/flows/<flow-id>.md).
 * Provider names live here and in the flow documents only (ADR 13).
 */
import type { SaleImporter } from "../application/importer";
import { yoogaSales } from "./yooga-sales";

export const saleImporters: readonly SaleImporter[] = [yoogaSales];
