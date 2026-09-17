/**
 * Formatting and vocabulary the two review benches share.
 *
 * An undecided destination is drawn as a blank to fill, not hidden behind an
 * em dash: the ledger never asserts what it does not know, and the screen says
 * so in the vernacular of the paper form it replaces.
 */
"use client";

import type {
  CatalogRecord,
  PendingAccountDescriptor,
  PendingCardDescriptor,
} from "@/lib/api";

const MONEY = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2 });

export function money(cents: string): string {
  const value = BigInt(cents);
  const sign = value < 0n ? "−" : "";
  return `${sign}${MONEY.format(Number(value < 0n ? -value : value) / 100)}`;
}

export function day(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Three bands, not a continuous ramp: "explains twenty lines" and "explains
 * one" are different kinds of job, and a smooth scale would blur that into
 * decoration. */
export function countClass(n: number): string {
  if (n >= 10) return "text-xl font-semibold";
  if (n >= 2) return "text-base font-semibold";
  return "text-sm font-medium text-muted-foreground";
}

/** The account's own name, or its id if the catalog has not loaded yet. */
export function accountName(
  accounts: CatalogRecord[],
  id: string | null | undefined,
): string {
  if (!id) return "";
  return String(accounts.find((account) => account.id === id)?.name ?? id);
}

export function Blank() {
  return (
    <span
      aria-label="por decidir"
      className="inline-block h-[0.9em] min-w-16 border-b-2 border-muted-foreground/40 align-baseline"
    />
  );
}

/*
 * The stored value stays the ledger's own enum; only the label is Portuguese.
 * Translating the value would put display text in the database and break every
 * comparison the parser and the CHECK constraint already agree on.
 */
export const METHODS = [
  ["PIX", "Pix"],
  ["BOLETO", "Boleto"],
  ["TRANSFER", "Transferência"],
  ["DEBIT_CARD", "Cartão de débito"],
  ["CREDIT_CARD", "Cartão de crédito"],
] as const;

export const METHOD_LABEL = new Map<string, string>(METHODS);

/* COMPANY leads because a statement's counterparties are overwhelmingly
 * businesses, so the common answer is the one already selected. */
export const PARTY_TYPES = [
  ["COMPANY", "Empresa"],
  ["PERSON", "Pessoa"],
  ["GOVERNMENT", "Governo"],
  ["OTHER", "Outro"],
] as const;

/**
 * A readable name out of what the statement printed: `papon_mini_-_mercado_e`
 * becomes `Papon Mini Mercado E`. A starting point to correct, not an answer —
 * the alternative is retyping a name that is already on the screen.
 */
export function humanize(key: string): string {
  return key
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export type Draft = {
  partyId: string;
  categoryId: string;
  method: string;
  counterAccountId: string;
  /** What the promoted expense or revenue will be called. Never a transfer's. */
  name: string;
};

/** One row of either queue, with the account-only fields optional. */
export type Pending = PendingCardDescriptor &
  Partial<Pick<PendingAccountDescriptor, "method" | "counterAccountId">>;

/**
 * Which kind a category has to be for this descriptor's movements to accept it.
 *
 * The promotion compares the category's kind against the movement's direction
 * and refuses a mismatch, so offering the other kind here would offer the one
 * answer that gets rejected. On an account the sign is direction; a card
 * invoice records a charge, so positive means money owed and every line becomes
 * an expense.
 */
export function wantedKind(
  side: "card" | "account",
  total: string,
): "EXPENSE" | "REVENUE" {
  if (side === "card") return "EXPENSE";
  return BigInt(total) > 0n ? "REVENUE" : "EXPENSE";
}
