import type { ApplicationRepository, PromotionWriters } from "../types";
import { createImportMethods } from "./import-statement";
import { createInsightMethods } from "./insights";
import { createPostingMethods } from "./post";
import { createReviewMethods } from "./review";

export type { ImportSummary } from "./import-statement";

/*
 * The expense and revenue writers arrive as a dependency rather than being
 * reached through the repository. Promotion has to create a cycle record, and
 * those writers live in sibling modules that only meet in `createApplication`;
 * taking them explicitly keeps this module callable on its own and typed.
 */
export function createMovementMethods(
  repository: ApplicationRepository,
  writers: PromotionWriters,
) {
  return {
    ...createImportMethods(repository),
    ...createReviewMethods(repository),
    ...createPostingMethods(repository, writers),
    ...createInsightMethods(repository),
  };
}
