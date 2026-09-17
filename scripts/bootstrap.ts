#!/usr/bin/env bun
import { randomBytes, randomUUID } from "node:crypto";
import { createAuthService } from "@lastro/auth";
import { closeDb, createDb, createRepositories } from "@lastro/db";
import { type Role, roles } from "@lastro/domain";
import { createBetterAuth } from "../apps/api/src/auth";

/*
 * First run on a fresh machine, and the way every later Book is added. Creates
 * the owner account if absent, selects or creates the named Book with its
 * membership, then mints one MCP agent credential bound to that Book.
 *
 * The owner, the Book and the membership are idempotent: re-running with the
 * same values reuses all three. The credential is not, and cannot be — its
 * secret is shown once and stored only as a hash, so a run that needs a token
 * has to issue one. Credentials are revocable individually; retire the ones
 * you stop using.
 *
 *   bun run bootstrap --email you@example.com --password '...' \
 *     --book Butler --agent agent:butler
 *
 * `--delegate` and `--role` are what make a read-only credential possible. The
 * role in the ExecutionContext comes from the *delegated operator's* membership
 * in the Book, resolved on every request, so a credential delegated to a
 * VIEWER can read the Book and is refused every write:
 *
 *   bun run bootstrap --email you@example.com --password '...' \
 *     --book Butler --delegate consolidator@lastro.local --role VIEWER \
 *     --agent agent:consolidator
 *
 * A delegate that is not the owner is created without a password — Better Auth
 * never sees it — so the identity cannot sign in to the dashboard at all. Its
 * only reach is the credential this script prints.
 *
 * Because membership is upserted, re-running with a different `--role` rewrites
 * the existing one. That is how you demote or promote an identity; it is also
 * how you would demote one by accident, so pass it deliberately.
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
const delegateEmail = arg("delegate");
const roleArg = arg("role") ?? "OWNER";

if (!email) {
  console.error(
    "Usage: bun run bootstrap --email <email> [--password <password>] [--book <name>] [--agent <principal>] [--delegate <email>] [--role OWNER|ADMIN|EDITOR|VIEWER]",
  );
  process.exit(1);
}
if (!roles.includes(roleArg as Role)) {
  console.error(`--role must be one of: ${roles.join(", ")}`);
  process.exit(1);
}
// The owner is OWNER in every Book it bootstraps. Accepting `--role VIEWER`
// without a delegate would hand back a full-access credential that reads as
// read-only, which is the one mistake this flag must not allow.
if (roleArg !== "OWNER" && !delegateEmail) {
  console.error("--role applies to --delegate; the owner is always OWNER.");
  process.exit(1);
}
const role = roleArg as Role;

const db = createDb(databaseUrl);
const repositories = createRepositories(db);
const auth = createAuthService(repositories.auth);
const betterAuth = createBetterAuth(db, { allowSignUp: true });

try {
  /*
   * The password creates the owner and nothing else. An earlier version signed
   * in with it on every run, which meant adding a fourth Book required the
   * current password and broke outright once the operator changed it in the
   * dashboard to something under twelve characters. It was never a boundary
   * anyway — this script holds DATABASE_URL, so it can already do more than any
   * session could.
   */
  const existingOwner = await repositories.getUserByEmail(email);
  let userId: string;

  if (existingOwner) {
    userId = existingOwner.id;
    console.log(`Owner already exists: ${email}`);
  } else {
    if (!password) {
      console.error(`--password is required to create the owner ${email}.`);
      process.exit(1);
    }
    if (password.length < 12) {
      console.error("Password must be at least 12 characters.");
      process.exit(1);
    }
    // Better Auth owns the password hash and the `account` row; going through
    // its API is what makes the operator able to actually sign in afterwards.
    const signUp = await betterAuth.api.signUpEmail({
      body: { email, password, name: arg("name") ?? email.split("@")[0] },
      asResponse: false,
    });
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
  console.log(
    existingBook
      ? `Using existing Book "${book.name}" (id ${book.id})`
      : `Created Book "${book.name}" (id ${book.id})`,
  );
  // Asserted on every run rather than only at creation. The upsert makes it
  // free, and it repairs a Book whose membership was removed by hand.
  await repositories.addBookMember({ bookId: book.id, userId, role: "OWNER" });

  const context = {
    actorId: userId,
    bookId: book.id,
    role: "OWNER" as const,
    source: "API" as const,
    correlationId: randomUUID(),
  };

  /*
   * Who the credential acts as. The owner by default; a separate identity when
   * the credential needs a different role in this Book — which is exactly what
   * a read-only consolidator is. `authenticateAgent` resolves the role from
   * this operator's membership on every request, so the credential itself
   * carries no privilege of its own.
   */
  let delegatedOperator = userId;
  if (delegateEmail && delegateEmail !== email) {
    /*
     * Created outside Better Auth on purpose: no password and no `account`
     * row, so this identity cannot sign in to the dashboard. Its only reach is
     * the credential printed below, and revoking that ends its access.
     */
    const delegate =
      (await repositories.getUserByEmail(delegateEmail)) ??
      (await repositories.createUser({
        id: randomUUID(),
        email: delegateEmail,
        name: delegateEmail.split("@")[0] ?? delegateEmail,
      }));
    if (!delegate) {
      throw new Error(`could not resolve delegate ${delegateEmail}`);
    }
    delegatedOperator = delegate.id;
    await repositories.addBookMember({
      bookId: book.id,
      userId: delegatedOperator,
      role,
    });
    console.log(`Delegate ${delegateEmail} is ${role} in "${book.name}"`);
  }

  const secret = randomBytes(32).toString("base64url");
  const issued = await auth.issueAgentCredential({
    context,
    bookId: book.id,
    principal: arg("agent") ?? "agent:local",
    delegatedOperator,
    secret,
  });

  // The stack may publish MCP on another port (a second install alongside an
  // existing one does), so echo the one this environment is configured for.
  const mcpPort = process.env.LASTRO_MCP_PORT ?? "3002";

  const grantedRole = delegatedOperator === userId ? "OWNER" : role;
  console.log(
    `\nMCP credential (shown once — store it now) — acts as ${grantedRole}:\n`,
  );
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
