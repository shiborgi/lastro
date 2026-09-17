import {
  type BookInsights,
  assertAuthorized,
  operations,
} from "@lastro/domain";
import { contextFor } from "../helpers";
import type { ApplicationRepository } from "../types";

export function createInsightMethods(repository: ApplicationRepository) {
  return {
    /** Everything the summary needs, behind the same read permission. */
    async bookInsights(contextInput: unknown): Promise<BookInsights> {
      const context = contextFor(contextInput);
      assertAuthorized(context, operations.listMovements);
      return repository.bookInsights(context.bookId);
    },
  };
}
