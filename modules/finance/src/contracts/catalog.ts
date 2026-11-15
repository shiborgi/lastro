/**
 * The catalogs every financial record points at. An agent that cannot list
 * or create these cannot record anything at all.
 */
import {
  CalendarDate,
  CalendarDateInput,
  Id,
  defineCrudOperations,
} from "@lastro/kernel";
import { z } from "zod";

export const DisplayName = z.string().trim().min(1).max(200);
export const AccountType = z.enum(["CARD", "ACCOUNT", "INVESTMENT", "CASH"]);
export const PartyType = z.string().trim().min(1).max(60);
export const FinancialCategoryKind = z.enum(["EXPENSE", "REVENUE"]);
export const FinancialCategoryRole = z.enum([
  "FIXED",
  "MERCHANDISE",
  "DEDUCTION",
]);
const AccountNumber = z.string().trim().min(1).max(40);

export const InstitutionResource = z
  .object({ id: Id, bookId: Id, key: Id, name: DisplayName })
  .strict();
export type InstitutionResource = z.infer<typeof InstitutionResource>;

export const institutions = defineCrudOperations({
  module: "finance",
  name: "Institution",
  plural: "Institutions",
  path: "/institutions",
  tool: "institution",
  tools: "institutions",
  resource: InstitutionResource,
  create: z.object({ key: Id, name: DisplayName }).strict(),
  update: z.object({ key: Id.optional(), name: DisplayName.optional() }),
  describe: {
    list: "List the Book's financial institutions and platforms.",
    create:
      "Register a financial institution or platform. `key` is a stable handle you choose, unique in the Book.",
    update: "Change an institution's key or name.",
    remove:
      "Delete an institution. Refused with CONFLICT while an account still belongs to it.",
  },
});

export const AccountResource = z
  .object({
    id: Id,
    bookId: Id,
    key: Id,
    institutionId: Id.nullable(),
    number: AccountNumber.nullable(),
    name: DisplayName,
    type: AccountType,
  })
  .strict();
export type AccountResource = z.infer<typeof AccountResource>;

const accountFields = {
  key: Id,
  name: DisplayName,
  type: AccountType,
  institutionId: Id.nullable().optional(),
  number: AccountNumber.nullable().optional(),
};

export const accounts = defineCrudOperations({
  module: "finance",
  name: "Account",
  plural: "Accounts",
  path: "/accounts",
  tool: "account",
  tools: "accounts",
  resource: AccountResource,
  create: z.object(accountFields).strict(),
  update: z.object(accountFields).partial(),
  describe: {
    list: "List the Book's accounts: only money the Book controls (bank accounts, cards, investments, cash).",
    create:
      "Register an account the Book controls. `type` is CARD, ACCOUNT, INVESTMENT or CASH. A company that owes the Book money (an acquirer, a voucher operator) is a party, never an account. `number` is as the institution prints it.",
    update: "Change an account.",
    remove:
      "Delete an account. Refused with CONFLICT while any record still references it.",
  },
});

export const AccountCycleResource = z
  .object({
    id: Id,
    bookId: Id,
    accountId: Id,
    referenceMonth: CalendarDate,
    startsOn: CalendarDate,
    endsOn: CalendarDate,
    dueOn: CalendarDate,
  })
  .strict();
export type AccountCycleResource = z.infer<typeof AccountCycleResource>;

export const accountCycles = defineCrudOperations({
  module: "finance",
  name: "AccountCycle",
  plural: "AccountCycles",
  path: "/account-cycles",
  tool: "account_cycle",
  tools: "account_cycles",
  resource: AccountCycleResource,
  create: z
    .object({
      accountId: Id,
      referenceMonth: CalendarDateInput,
      startsOn: CalendarDateInput,
      endsOn: CalendarDateInput,
      dueOn: CalendarDateInput,
    })
    .strict()
    .refine(
      (value) => value.startsOn <= value.endsOn,
      "startsOn must not be after endsOn",
    )
    .refine(
      (value) => value.endsOn <= value.dueOn,
      "dueOn must not be before endsOn",
    ),
  update: z.object({
    referenceMonth: CalendarDateInput.optional(),
    startsOn: CalendarDateInput.optional(),
    endsOn: CalendarDateInput.optional(),
    dueOn: CalendarDateInput.optional(),
  }),
  filter: z.object({ accountId: Id.optional() }),
  describe: {
    list: "List card billing windows, one per invoice: which purchase dates each reference month covers. Filter by accountId.",
    create:
      "Register a card's billing window for one invoice: `referenceMonth` names the invoice, `startsOn`..`endsOn` the purchase dates it covers, `dueOn` the day it is due (the card payment of that month is due then). Windows of one account cannot overlap.",
    update: "Change a billing window's month or dates.",
    remove: "Delete a billing window.",
  },
});

export const PartyResource = z
  .object({
    id: Id,
    bookId: Id,
    key: Id,
    name: DisplayName,
    type: PartyType,
  })
  .strict();
export type PartyResource = z.infer<typeof PartyResource>;

const partyFields = {
  key: Id,
  name: DisplayName,
  type: PartyType,
};

export const parties = defineCrudOperations({
  module: "finance",
  name: "Party",
  plural: "Parties",
  path: "/parties",
  tool: "party",
  tools: "parties",
  resource: PartyResource,
  create: z.object(partyFields).strict(),
  update: z.object(partyFields).partial(),
  filter: z.object({}),
  describe: {
    list: "List the Book's parties: the people and companies on the other side of its records.",
    create:
      "Register a party: a person or company on the other side of the Book's records.",
    update: "Change a party.",
    remove:
      "Delete a party. Refused with CONFLICT while any record still references it.",
  },
});

export const FinancialCategoryResource = z
  .object({
    id: Id,
    bookId: Id,
    kind: FinancialCategoryKind,
    name: DisplayName,
    parentId: Id.nullable(),
    role: FinancialCategoryRole.nullable(),
  })
  .strict();
export type FinancialCategoryResource = z.infer<
  typeof FinancialCategoryResource
>;

const financialCategoryFields = {
  name: DisplayName,
  kind: FinancialCategoryKind,
  parentId: Id.nullable().optional(),
  role: FinancialCategoryRole.nullable().optional(),
};

export const financialCategories = defineCrudOperations({
  module: "finance",
  name: "FinancialCategory",
  plural: "FinancialCategories",
  path: "/financial-categories",
  tool: "financial_category",
  tools: "financial_categories",
  resource: FinancialCategoryResource,
  create: z.object(financialCategoryFields).strict(),
  update: z.object(financialCategoryFields).partial(),
  filter: z.object({ kind: FinancialCategoryKind.optional() }),
  describe: {
    list: "List the chart of accounts. A category with `parentId` sits inside a group; groups nest one level. Filter by kind.",
    create:
      "Create an EXPENSE or REVENUE category, optionally inside a group of the same kind (`parentId`). A group holds categories, never records. `role`: FIXED or MERCHANDISE classify expenses for result reports; DEDUCTION marks a category whose items are negative (a fee on a revenue, a discount on an expense).",
    update:
      "Change a category. Refused with CONFLICT when the change would break nesting, leave existing items with the wrong sign.",
    remove:
      "Delete a category. Refused with CONFLICT while any record or child category still references it.",
  },
});

export const catalogOperations = [
  institutions,
  accounts,
  accountCycles,
  parties,
  financialCategories,
].flatMap((crud) => Object.values(crud));
