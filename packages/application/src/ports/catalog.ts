/**
 * Everything a Book names before it can record money: the institutions and
 * accounts, the parties and categories, the statement descriptors that map one
 * to the other, and the card billing windows.
 */
import type {
  Account,
  AccountDescriptor,
  AccountReferenceMonth,
  AuditEvent,
  Book,
  CardDescriptor,
  Category,
  CategoryKind,
  Institution,
  Party,
  PaymentMethod,
  PendingAccountDescriptor,
  PendingCardDescriptor,
} from "@lastro/domain";

export type CatalogRepository = {
  listBooks: (actorId: string, bookId?: string) => Promise<Book[]>;
  createInstitution: (
    input: Omit<Institution, "id"> & { idempotencyKey?: string },
    audit: AuditEvent,
  ) => Promise<Institution>;
  listInstitutions: (bookId: string) => Promise<Institution[]>;
  updateInstitution: (
    input: { bookId: string; id: string; key?: string; name?: string },
    audit: AuditEvent,
  ) => Promise<Institution>;
  deleteInstitution: (
    bookId: string,
    id: string,
    audit: AuditEvent,
  ) => Promise<void>;
  createAccount: (
    input: Omit<Account, "id"> & { idempotencyKey?: string },
    audit: AuditEvent,
  ) => Promise<Account>;
  listAccounts: (bookId: string) => Promise<Account[]>;
  updateAccount: (
    input: {
      bookId: string;
      id: string;
      key?: string;
      institutionId?: string | null;
      number?: string | null;
      name?: string;
      type?: string;
    },
    audit: AuditEvent,
  ) => Promise<Account>;
  deleteAccount: (
    bookId: string,
    id: string,
    audit: AuditEvent,
  ) => Promise<void>;
  createParty: (
    input: Omit<Party, "id"> & { idempotencyKey?: string },
    audit: AuditEvent,
  ) => Promise<Party>;
  listParties: (bookId: string) => Promise<Party[]>;
  updateParty: (
    input: {
      bookId: string;
      id: string;
      key?: string;
      name?: string;
      type?: string;
    },
    audit: AuditEvent,
  ) => Promise<Party>;
  deleteParty: (bookId: string, id: string, audit: AuditEvent) => Promise<void>;
  createCardDescriptor: (
    input: Omit<CardDescriptor, "id" | "createdAt"> & {
      idempotencyKey?: string;
    },
    audit: AuditEvent,
  ) => Promise<CardDescriptor>;
  listCardDescriptors: (bookId: string) => Promise<CardDescriptor[]>;
  updateCardDescriptor: (
    input: {
      bookId: string;
      id: string;
      partyId?: string | null;
      categoryId?: string | null;
      name?: string | null;
    },
    audit: AuditEvent,
  ) => Promise<CardDescriptor>;
  deleteCardDescriptor: (
    bookId: string,
    id: string,
    audit: AuditEvent,
  ) => Promise<void>;
  ensureCardDescriptors: (
    bookId: string,
    accountId: string,
    keys: string[],
  ) => Promise<CardDescriptor[]>;
  listPendingCardDescriptors: (
    bookId: string,
  ) => Promise<PendingCardDescriptor[]>;
  getCardDescriptorByKey: (
    bookId: string,
    key: string,
  ) => Promise<CardDescriptor | null>;

  createAccountDescriptor: (
    input: Omit<AccountDescriptor, "id" | "createdAt"> & {
      idempotencyKey?: string;
    },
    audit: AuditEvent,
  ) => Promise<AccountDescriptor>;
  listAccountDescriptors: (bookId: string) => Promise<AccountDescriptor[]>;
  updateAccountDescriptor: (
    input: {
      bookId: string;
      id: string;
      partyId?: string | null;
      categoryId?: string | null;
      method?: PaymentMethod | null;
      counterAccountId?: string | null;
      name?: string | null;
    },
    audit: AuditEvent,
  ) => Promise<AccountDescriptor>;
  deleteAccountDescriptor: (
    bookId: string,
    id: string,
    audit: AuditEvent,
  ) => Promise<void>;
  ensureAccountDescriptors: (
    bookId: string,
    accountId: string,
    entries: { key: string; method: PaymentMethod | null }[],
  ) => Promise<AccountDescriptor[]>;
  listPendingAccountDescriptors: (
    bookId: string,
  ) => Promise<PendingAccountDescriptor[]>;
  getAccountDescriptorByKey: (
    bookId: string,
    key: string,
  ) => Promise<AccountDescriptor | null>;
  createCategory: (
    input: Omit<Category, "id"> & { idempotencyKey?: string },
    audit: AuditEvent,
  ) => Promise<Category>;
  listCategories: (bookId: string, kind?: CategoryKind) => Promise<Category[]>;
  updateCategory: (
    input: {
      bookId: string;
      id: string;
      name?: string;
      kind?: CategoryKind;
      parentId?: string | null;
    },
    audit: AuditEvent,
  ) => Promise<Category>;
  deleteCategory: (
    bookId: string,
    id: string,
    audit: AuditEvent,
  ) => Promise<void>;
  createAccountReferenceMonth: (
    input: Omit<AccountReferenceMonth, "id" | "createdAt">,
    audit: AuditEvent,
  ) => Promise<AccountReferenceMonth>;
  listAccountReferenceMonths: (
    bookId: string,
    accountId?: string,
  ) => Promise<AccountReferenceMonth[]>;
  updateAccountReferenceMonth: (
    input: {
      bookId: string;
      id: string;
      referenceMonth?: Date;
      startDate?: Date;
      endDate?: Date;
    },
    audit: AuditEvent,
  ) => Promise<AccountReferenceMonth>;
  deleteAccountReferenceMonth: (
    bookId: string,
    id: string,
    audit: AuditEvent,
  ) => Promise<void>;
};
