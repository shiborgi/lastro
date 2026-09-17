/**
 * Importing a statement.
 *
 * The import records what a file said and nothing more. It never decides that a
 * line is an expense, never invents an institution, and never guesses which
 * merchant or which account a line belongs to — it records the ones it has
 * never seen, without a destination, for a person to map (ADR 8).
 *
 * The order of writes here is load-bearing: descriptors first, movements
 * second. Every movement carries a foreign key to its descriptor table, so
 * inserting them the other way round fails the whole import.
 */
import {
  type MovementStatus,
  assertAuthorized,
  operations,
} from "@lastro/domain";
import { contextFor, requireText } from "../helpers";
import {
  type StagedStatement,
  resolveStatementPlugin,
  stageStatement,
} from "../statements";
import type { ApplicationRepository, ImportStatementCommand } from "../types";

export type ImportSummary = {
  institutionKey: string;
  kind: "card" | "account";
  source: string;
  /** Rows the file contained. */
  rows: number;
  /** Rows that were new. The rest were already imported. */
  inserted: number;
  duplicates: number;
  /** Descriptors recorded for the first time, still without a party. */
  newDescriptors: number;
  /**
   * Of those, the account-side ones whose text implied no payment method
   * either. A card descriptor stores no method, so it is never counted here.
   */
  methodUndecided: number;
};

export function createImportMethods(repository: ApplicationRepository) {
  return {
    async importStatement(
      input: ImportStatementCommand,
    ): Promise<ImportSummary> {
      const context = contextFor(input.context);
      assertAuthorized(context, operations.importStatement);
      requireText(input.path, "path");
      requireText(input.content, "content");

      const { plugin, location } = resolveStatementPlugin(input.path);

      /*
       * The institution has to exist already. Creating it here would be the
       * import inventing an entity from a directory name — and because the
       * catalog is per Book, a typo would silently open a second institution
       * beside the real one rather than failing.
       */
      const institutions = await repository.listInstitutions(context.bookId);
      const institution = institutions.find(
        (candidate) => candidate.key === location.institutionKey,
      );
      if (!institution) {
        // Naming what does exist is the difference between "unsupported" and
        // an operator seeing they wrote `nubank` where the Book has `nu`.
        const known = institutions.map((each) => each.key).join(", ");
        const suffix = known ? ` (known: ${known})` : "";
        throw new Error(
          `no institution "${location.institutionKey}" in this Book; create it first${suffix}`,
        );
      }

      /*
       * The account has to exist and has to belong to this institution.
       * Everything downstream keys off it — the descriptors are per account —
       * so a wrong id here files one account's spending under another, and the
       * foreign keys would accept it happily.
       */
      const accounts = await repository.listAccounts(context.bookId);
      const account = accounts.find(
        (candidate) => candidate.id === input.accountId,
      );
      if (!account) {
        throw new Error(`no account "${input.accountId}" in this Book`);
      }
      if (account.institutionId !== institution.id) {
        throw new Error(
          `account "${account.name}" does not belong to ${institution.key}`,
        );
      }
      /*
       * A card invoice belongs to a CARD account and a statement does not.
       * This is the one check the file itself makes possible without reading a
       * row, and it catches the mistake that motivated it: importing the C6
       * invoice under the C6 checking account was accepted, and created a
       * second set of descriptors nobody would ever look at.
       */
      const wantsCard = plugin.kind === "card";
      if (wantsCard !== (account.type === "CARD")) {
        throw new Error(
          `a ${plugin.kind} statement does not belong to a ${account.type} account`,
        );
      }

      const staged: StagedStatement = stageStatement(
        plugin,
        plugin.parse(input.content),
        { institutionId: institution.id, accountId: input.accountId },
      );

      /*
       * When the statement prints its own account number, it has to be the
       * account named. The Nubank export prints none — which is why the id is
       * stated rather than read — but where the file does say, a disagreement
       * is a file in the wrong place, and importing it anyway would attribute
       * real money to the wrong account.
       */
      const printed = staged.header.accountNumber;
      if (printed && account.number && printed !== account.number) {
        throw new Error(
          `this statement is for account ${printed}, not "${account.name}" (${account.number})`,
        );
      }

      /*
       * Before the movements, which carry a foreign key to it. Each descriptor
       * arrives with the method its own text implies — a value sitting where a
       * person can see and change it, rather than an inference written straight
       * onto the money. An alias that already exists is left alone, so a
       * re-import never resets a mapping someone made.
       */
      /*
       * One side only, the side this file is. Asking for both would demand a
       * repository implement the card path to import an account statement, and
       * would send an empty write to a table the file never touched.
       */
      const created =
        staged.kind === "card"
          ? await repository.ensureCardDescriptors(
              context.bookId,
              input.accountId,
              staged.cardDescriptors,
            )
          : await repository.ensureAccountDescriptors(
              context.bookId,
              input.accountId,
              staged.accountDescriptors,
            );

      const common = {
        bookId: context.bookId,
        institutionId: institution.id,
        accountId: input.accountId,
        source: input.path,
        status: "PENDING" as MovementStatus,
        expenseId: null,
      };

      // Only the rows that were actually new come back — the unique index on
      // (book, key, occurrence) silently drops the rest, which is what makes a
      // re-import a no-op instead of a doubling.
      const inserted =
        staged.kind === "card"
          ? await repository.insertCardMovements(
              staged.card.map((row) => ({
                ...common,
                ...row,
                createdAt: undefined,
              })),
            )
          : await repository.insertAccountMovements(
              staged.account.map((row) => ({
                ...common,
                /*
                 * The preamble copied onto every row. Which account a movement
                 * belongs to is `accountId` now, stated at import — these two
                 * are what the statement itself printed, kept as evidence
                 * beside it rather than as identity.
                 */
                branch: staged.header.branch ?? null,
                accountNumber: staged.header.accountNumber ?? null,
                ...row,
                createdAt: undefined,
              })),
            );

      const rows =
        staged.kind === "card" ? staged.card.length : staged.account.length;
      return {
        institutionKey: location.institutionKey,
        kind: staged.kind,
        source: input.path,
        rows,
        inserted: inserted.length,
        duplicates: rows - inserted.length,
        newDescriptors: created.length,
        // Only the account side infers a method, so only it can leave one
        // undecided. A card descriptor has no method to decide.
        methodUndecided:
          staged.kind === "card"
            ? 0
            : created.filter(
                (descriptor) => !("method" in descriptor && descriptor.method),
              ).length,
      };
    },
  };
}
