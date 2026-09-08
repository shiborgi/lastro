#!/usr/bin/env bun
import { randomBytes, randomUUID } from "node:crypto";
import { createAuthService } from "@lastro/auth";
import { closeDb, createDb, createRepositories } from "@lastro/db";
import { createBetterAuth } from "../apps/api/src/auth";

/*
 * First run on a fresh machine, and the way every later Book is added. Creates
 * the owner account if absent, selects or creates the named Book with its
 * membership, then mints one MCP agent credential bound to that Book.
 *
 * The owner and the Book are idempotent: re-running with the same values
 * reuses both. The credential is not, and cannot be — its secret is shown once
 * and stored only as a hash, so a run that needs a token has to issue one.
 * Credentials are revocable individually; retire the ones you stop using.
 *
 *   bun run bootstrap --email you@example.com --password '...' \
 *     --book Butler --agent agent:butler
 */

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const email = arg("email") ?? process.env.LASTRO_OWNER_EMAIL;
const password = arg("password") ?? process.env.LASTRO_OWNER_PASSWORD;
const bookName = arg("book") ?? "Personal";

if (!email || !password) {
  console.error(
    "Usage: bun run bootstrap --email <email> --password <password> [--book <name>] [--agent <principal>]",
  );
  process.exit(1);
}
if (password.length < 12) {
  console.error("Password must be at least 12 characters.");
  process.exit(1);
}

const db = createDb(databaseUrl);
const repositories = createRepositories(db);
const auth = createAuthService(repositories.auth);
const betterAuth = createBetterAuth(db, { allowSignUp: true });

try {
  // Better Auth owns the password hash and the `account` row; going through
  // its API is what makes the operator able to actually sign in afterwards.
  let userId: string;
  const signUp = await betterAuth.api
    .signUpEmail({
      body: { email, password, name: arg("name") ?? email.split("@")[0] },
      asResponse: false,
    })
    .catch((error: unknown) => ({ error }));

  if ("error" in signUp) {
    const existing = await betterAuth.api.signInEmail({
      body: { email, password },
      asResponse: false,
    });
    userId = existing.user.id;
    console.log(`Owner already exists: ${email}`);
  } else {
    userId = signUp.user.id;
    console.log(`Created owner: ${email}`);
  }

  /*
   * The Book is matched by name, not by position: one owner runs several Books
   * side by side — one per agent that writes to the ledger — and each agent's
   * credential is bound to its own. Matching the first Book instead would make
   * `--book` silently inert from the second run on, and every credential would
   * come back pointing at the same ledger.
   */
  const books = await repositories.listBooks(userId);
  const existingBook = books.find((candidate) => candidate.name === bookName);
  const book = existingBook ?? (await repositories.createBook(bookName));
  if (existingBook) {
    console.log(`Using existing Book "${book.name}" (id ${book.id})`);
  } else {
    await repositories.addBookMember({
      bookId: book.id,
      userId,
      role: "OWNER",
    });
    console.log(`Created Book "${book.name}" (id ${book.id})`);
  }

  const context = {
    actorId: userId,
    bookId: book.id,
    role: "OWNER" as const,
    source: "API" as const,
    correlationId: randomUUID(),
  };

  const secret = randomBytes(32).toString("base64url");
  const issued = await auth.issueAgentCredential({
    context,
    bookId: book.id,
    principal: arg("agent") ?? "agent:local",
    delegatedOperator: userId,
    secret,
  });

  // The stack may publish MCP on another port (a second install alongside an
  // existing one does), so echo the one this environment is configured for.
  const mcpPort = process.env.LASTRO_MCP_PORT ?? "3002";

  console.log("\nMCP credential (shown once — store it now):\n");
  console.log(`  MCP_BEARER_TOKEN=${issued.credential.id}.${issued.secret}`);
  console.log(`  MCP_BOOK_ID=${book.id}\n`);
  console.log(`Point an MCP client at http://127.0.0.1:${mcpPort}/mcp with:`);
  console.log(
    `  Authorization: Bearer ${issued.credential.id}.${issued.secret}`,
  );
  // The credential carries its Book, so this header is an optional assertion:
  // send it and a token for a different Book is rejected instead of silently
  // writing to the wrong ledger.
  console.log(`  x-book-id: ${book.id}    (optional; must match if sent)`);
} finally {
  await closeDb(db);
}
