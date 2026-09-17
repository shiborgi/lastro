/**
 * A repository stub for tests that exercise one command at a time.
 *
 * The port requires every method, which is what makes a real adapter's gap a
 * compile error. A test that only cares about `createExpense` still should not
 * have to write the other sixty-eight, so this fills them with a thunk that
 * throws when called — the same failure the optional-slot port used to produce,
 * now confined to the test seam instead of guarding every production call.
 *
 * Only for tests. Nothing in `apps/` or `packages/db` should reach for it.
 */
import type { ApplicationRepository } from "./ports";

export function fakeRepository(
  partial: Partial<ApplicationRepository>,
): ApplicationRepository {
  return new Proxy(partial, {
    get(target, name: string | symbol) {
      const candidate = target[name as keyof ApplicationRepository];
      if (candidate !== undefined) return candidate;
      if (typeof name === "symbol") return undefined;
      return () => {
        throw new Error(`repository method ${name} is not configured`);
      };
    },
  }) as ApplicationRepository;
}
