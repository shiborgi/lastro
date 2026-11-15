/**
 * What a Book names before it can record money: the institutions and
 * accounts, the parties it deals with, and the chart of accounts.
 */
export type Institution = {
  id: string;
  bookId: string;
  key: string;
  name: string;
};

/**
 * The kinds of place money sits: only money the Book controls (ADR 8).
 * Whoever owes it before it lands is a party with a role, not an account.
 * The type decides what a movement against the account can mean: a CARD is
 * settled by paying its invoice, an ACCOUNT moves cash directly.
 */
export const accountTypes = ["CARD", "ACCOUNT", "INVESTMENT", "CASH"] as const;
export type AccountType = (typeof accountTypes)[number];

export type Account = {
  id: string;
  bookId: string;
  key: string;
  institutionId: string | null;
  /** As the institution prints it: an account number, or a card's last four. */
  number: string | null;
  name: string;
  type: AccountType;
};

/**
 * A card's billing cycle, one row per invoice, filled by hand: no statement
 * says which window produced its purchases. The due date is not stored; it is
 * derived from the cycle a purchase falls in.
 */
export type AccountCycle = {
  id: string;
  bookId: string;
  accountId: string;
  referenceMonth: Date;
  startsOn: Date;
  endsOn: Date;
  /** The day the invoice is due. */
  dueOn: Date;
};

export type Party = {
  id: string;
  bookId: string;
  key: string;
  name: string;
  type: string;
};

export const financialCategoryKinds = ["EXPENSE", "REVENUE"] as const;
export type FinancialCategoryKind = (typeof financialCategoryKinds)[number];

/*
 * FIXED and MERCHANDISE say how a result report treats an expense category.
 * DEDUCTION says a category's items are negative (ADR 6) and is the one
 * role a REVENUE category may take.
 */
export const financialCategoryRoles = [
  "FIXED",
  "MERCHANDISE",
  "DEDUCTION",
] as const;
export type FinancialCategoryRole = (typeof financialCategoryRoles)[number];

export type FinancialCategory = {
  id: string;
  bookId: string;
  /** The group this sits inside, one level only; null for a group or a loner. */
  parentId: string | null;
  kind: FinancialCategoryKind;
  name: string;
  role: FinancialCategoryRole | null;
};

type FinancialCategoryFacts = Pick<
  FinancialCategory,
  "id" | "kind" | "role" | "parentId"
>;

/** A category holds negative items when it or its group has the DEDUCTION role. */
export function isDeduction(
  financialCategoryId: string,
  categories: readonly FinancialCategoryFacts[],
): boolean {
  const category = categories.find((each) => each.id === financialCategoryId);
  if (!category) return false;
  if (category.role === "DEDUCTION") return true;
  return (
    categories.find((each) => each.id === category.parentId)?.role ===
    "DEDUCTION"
  );
}
