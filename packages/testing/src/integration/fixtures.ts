/** Books and members for the integration suite, unique per call. */
import { randomUUID } from "node:crypto";
import { createCoreRepository } from "@lastro/core/db";
import type { Database } from "@lastro/host";
import type { ExecutionContext, Role } from "@lastro/kernel";

export async function seedBook(db: Database, memberRoles: readonly Role[]) {
  const core = createCoreRepository(db);
  const tag = randomUUID().slice(0, 8);
  const book = await core.createBook({
    key: `book-${tag}`,
    name: `Book ${tag}`,
  });
  const members = {} as Record<Role, string>;
  for (const role of memberRoles) {
    const user = await core.createUser({
      id: `${role.toLowerCase()}-${tag}`,
      email: `${role.toLowerCase()}-${tag}@lastro.test`,
      name: role,
    });
    await core.setBookMember({ bookId: book.id, userId: user.id, role });
    members[role] = user.id;
  }
  const as = (
    role: Role,
    extra: Partial<ExecutionContext> = {},
  ): ExecutionContext => ({
    actorId: members[role],
    bookId: book.id,
    role,
    source: "API",
    correlationId: randomUUID(),
    ...extra,
  });
  return { book, members, as, core };
}
