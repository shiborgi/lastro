#!/usr/bin/env bun
/*
 * First run on a fresh machine, and the way every later Book is added. Creates
 * the owner if absent, ensures the Book (by key) and the owner's membership,
 * then issues one agent credential bound to that Book.
 *
 * The owner, the Book and the membership are idempotent: re-running with the
 * same values reuses all three. The credential is not and cannot be: its
 * secret is shown once and stored only as a hash. Revoke the ones you retire
 * with the `revoke_agent_credential` tool.
 *
 *   bun run bootstrap --email you@example.com --password '...' \
 *     --book "My business" --agent agent:example
 *
 * `--delegate` and `--role` make a credential with less reach than the owner:
 * the agent acts as the delegate, whose role in the Book is resolved on every
 * request. A delegate is created without a password, so it cannot sign in to
 * the web app; its only reach is the credential printed here.
 *
 *   bun run bootstrap --email you@example.com --book "My business" \
 *     --delegate agent@lastro.local --role EDITOR --agent agent:example
 *
 * Membership is upserted, so re-running with another `--role` rewrites it.
 */
import { randomUUID } from "node:crypto";
import { closeDb, createDb, createHost } from "@lastro/host";
import { type Role, roles } from "@lastro/kernel";
import { createSessions } from "../apps/api/src/auth";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const email = arg("email") ?? process.env.LASTRO_OWNER_EMAIL;
const password = arg("password") ?? process.env.LASTRO_OWNER_PASSWORD;
const bookName = arg("book") ?? "Personal";
const bookKey = arg("key") ?? slugify(bookName);
const delegateEmail = arg("delegate");
const roleArg = arg("role") ?? "OWNER";

if (!email) {
  console.error(
    "Usage: bun run bootstrap --email <email> [--password <password>] [--book <name>] [--key <key>] [--agent <principal>] [--delegate <email>] [--role OWNER|ADMIN|EDITOR|VIEWER]",
  );
  process.exit(1);
}
if (!roles.includes(roleArg as Role)) {
  console.error(`--role must be one of: ${roles.join(", ")}`);
  process.exit(1);
}
// A non-owner role without a delegate would hand back a full-access credential
// that reads as limited: the one mistake this flag must not allow.
if (roleArg !== "OWNER" && !delegateEmail) {
  console.error("--role applies to --delegate; the owner is always OWNER.");
  process.exit(1);
}
const role = roleArg as Role;

const db = createDb(databaseUrl);
const { admin } = createHost(db).modules.core;

try {
  const existing = await admin.getUserByEmail(email);
  let ownerId: string;
  if (existing) {
    ownerId = existing.id;
    console.log(`Owner already exists: ${email}`);
  } else {
    if (!password || password.length < 12) {
      console.error(
        `--password of at least 12 characters is required to create the owner ${email}.`,
      );
      process.exit(1);
    }
    // Better Auth owns the password hash; signing up through it is what lets the owner sign in.
    const sessions = createSessions(db, { allowSignUp: true });
    const signUp = await sessions.api.signUpEmail({
      body: {
        email,
        password,
        name: arg("name") ?? email.split("@")[0] ?? email,
      },
      asResponse: false,
    });
    ownerId = signUp.user.id;
    console.log(`Created owner: ${email}`);
  }

  const book = await admin.ensureBook({ key: bookKey, name: bookName });
  await admin.setBookMember({
    bookId: book.id,
    userId: ownerId,
    role: "OWNER",
  });
  console.log(
    `Book "${book.name}" (key ${book.key}, id ${book.id}); ${email} is OWNER`,
  );

  let operator = ownerId;
  if (delegateEmail && delegateEmail !== email) {
    const delegate =
      (await admin.getUserByEmail(delegateEmail)) ??
      (await admin.createUser({
        id: randomUUID(),
        email: delegateEmail,
        name: delegateEmail.split("@")[0] ?? delegateEmail,
      }));
    operator = delegate.id;
    await admin.setBookMember({ bookId: book.id, userId: operator, role });
    console.log(`Delegate ${delegateEmail} is ${role} in "${book.name}"`);
  }

  const issued = await admin.issueAgentCredential({
    bookId: book.id,
    principal: arg("agent") ?? "agent:local",
    delegatedOperator: operator,
    issuedBy: `bootstrap:${email}`,
  });
  const mcpPort = process.env.LASTRO_MCP_PORT ?? "3002";
  console.log(
    `\nAgent credential (shown once; store it now), acting as ${issued.role}:\n`,
  );
  console.log(`  MCP_BEARER_TOKEN=${issued.token}`);
  console.log(`  MCP_BOOK_ID=${book.id}\n`);
  console.log(
    `Point an MCP client at each module it uses, http://127.0.0.1:${mcpPort}/mcp/<module>\n(core, finance, finance-imports, sales, sales-imports, close), with:`,
  );
  console.log(`  Authorization: Bearer ${issued.token}`);
  console.log(`  x-book-id: ${book.id}    (optional; must match if sent)`);
} finally {
  await closeDb(db);
}
