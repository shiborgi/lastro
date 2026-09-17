/**
 * Guessing how money moved, from the words the institution printed.
 *
 * This is the one place in the import that infers anything, and it is allowed
 * to because a payment method is a description of the movement, not an economic
 * fact: calling a transfer "Pix" changes neither the amount nor the party. What
 * it must never do is guess silently — every result lands in `payment_alias`,
 * marked as inferred, where a person sees it and can overrule it once for good.
 *
 * Measured against a real 139-line C6 statement and a 23-line Nubank export:
 * 93% of rows classify, and the 7% that do not are the ones whose text names
 * only a supplier (VIVO - GVT, SIMPLES NACIONAL). Those stay null. The file
 * does not say how they were paid, and a plausible guess about someone's money
 * is worse than an empty field.
 */

import type { PaymentMethod } from "@lastro/domain";

/*
 * Word boundaries, not substrings. `"TED" in text` also matches UNITED,
 * LIMITED and CREDITED — none of which is a wire transfer. The two files in
 * hand happen to contain no such merchant, which is exactly why the rule has
 * to be written for the ones that will.
 */
export interface MethodRule {
  pattern: RegExp;
  method: PaymentMethod;
}

/*
 * Brazilian banking vocabulary, printed by every bank. Anything one
 * institution words its own way lives in that institution's plugin instead —
 * see `StatementPlugin.methodRules`.
 */
const SHARED: MethodRule[] = [
  { pattern: /\bPIX\b/, method: "PIX" },
  // TED and DOC are both wire transfers; the distinction between them is a
  // clearing detail the ledger has no use for. PIX is listed first because a
  // Pix line often also says "transferência", and the more specific rail wins.
  { pattern: /\bTED\b/, method: "TRANSFER" },
  { pattern: /\bDOC\b/, method: "TRANSFER" },
  { pattern: /\bBOLETO\b/, method: "BOLETO" },
  { pattern: /DEBITO\s+DE\s+CARTAO/, method: "DEBIT_CARD" },
];

/**
 * The method a line's own text implies, or null when it implies none.
 *
 * Accents are folded first so `Débito` and `DEBITO` read alike; the exports
 * are inconsistent about them even within one file.
 */
export function inferPaymentMethod(
  parts: (string | undefined | null)[],
  /* An institution's own wording wins over the shared vocabulary: it is the
   * more specific claim about the same text. */
  own: readonly MethodRule[] = [],
): PaymentMethod | null {
  const text = parts
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase();
  if (!text) return null;
  for (const rule of [...own, ...SHARED]) {
    if (rule.pattern.test(text)) return rule.method;
  }
  return null;
}
