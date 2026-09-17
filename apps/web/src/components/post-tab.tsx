"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { type CatalogRecord, type Movement, api } from "@/lib/api";
import { formatStatementAmount } from "@/lib/money";
import {
  type Becomes,
  type Blocker,
  type PromotionPlan,
  type ReadyDecision,
  type Side,
  planPromotion,
  referenceMonthOf,
} from "@/lib/promotion";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Lançar — the crossing from the review bench into the ledger.
 *
 * Every line arrives here already decided: a descriptor names its party and
 * category, or names the account on the other side. What was missing was any
 * way to act on that, so eighty-one provable lines sat in the same queue as
 * the hundred and thirty-five nobody had looked at, indistinguishable.
 *
 * Two choices shape the screen, and both come from the product rather than
 * from a layout preference.
 *
 * The unit is the decision, not the line. One wording covers every line that
 * shares it, and the operator resolved all of them at once at the bench — so
 * the list shows one row per descriptor, with what it maps to and what it will
 * become, and Lançar acts on the group. A table of eighty-one rows with a
 * checkbox on each would ask the same question twenty-one times and imply a
 * choice that does not exist: a ready line is ready.
 *
 * And what is *not* ready is summarised by reason, never listed. "Forty-seven
 * lines have no category" is one sentence and one destination; the lines
 * themselves are already on the movements screen, and repeating them here
 * would be a backlog to read instead of a next action.
 */

const BECOMES: Record<Becomes, string> = {
  expense: "despesa",
  revenue: "receita",
  transfer: "transferência",
};

/*
 * The reasons, in the operator's words, with what to do about each. `card-
 * credit` is the one that is not a mapping problem: a credit on an invoice is
 * the bill being paid, and the answer is to ignore the line, not to classify
 * it.
 */
const BLOCKERS: Record<Blocker, { label: string; fix: string }> = {
  "no-party": {
    label: "sem parte",
    fix: "escolha com quem foi, na revisão",
  },
  "no-category": {
    label: "sem categoria",
    fix: "escolha a categoria, na revisão",
  },
  "wrong-kind": {
    label: "categoria do tipo trocado",
    fix: "entrada mapeada em categoria de despesa, ou o contrário",
  },
  "card-credit": {
    label: "crédito na fatura",
    fix: "é o pagamento da fatura ou um estorno; ignore em vez de lançar",
  },
  "no-descriptor": {
    label: "sem descritor",
    fix: "a linha não tem redação registrada; reimporte o arquivo",
  },
};

const SIDES: Record<Side, string> = { card: "Fatura", account: "Extrato" };

function day(iso: string | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
}

/** What one attempt did. A refusal keeps the server's message verbatim. */
type Outcome =
  | { id: string; ok: true; becomes: string }
  | { id: string; ok: false; message: string };

type Run = { total: number; done: number; finished: boolean };

/**
 * The chip that says what a decision produces.
 *
 * The colours are the palette's cash-direction pair, already meaning money in
 * and money out everywhere else in the app. A transfer deliberately gets
 * neither: it is not income and not a cost, and giving it a direction would
 * claim one it does not have.
 */
function BecomesChip({ becomes }: { becomes: Becomes }) {
  return (
    <span
      className={cn(
        "rounded-sm px-1.5 py-0.5 text-xs whitespace-nowrap",
        becomes === "revenue" && "bg-flow-in/12 text-flow-in",
        becomes === "expense" && "bg-flow-out/12 text-flow-out",
        becomes === "transfer" && "bg-muted text-muted-foreground",
      )}
    >
      {BECOMES[becomes]}
    </span>
  );
}

export function PostTab({
  bookId,
  onReview,
  onReadyLines,
}: {
  bookId: string;
  /** Jump to the bench that clears a reason. */
  onReview?: (side: Side) => void;
  /** How many lines are decided and unposted, for the rail's count. */
  onReadyLines?: (lines: number) => void;
}) {
  const [plan, setPlan] = useState<PromotionPlan | null>(null);
  const [accounts, setAccounts] = useState<CatalogRecord[]>([]);
  const [parties, setParties] = useState<CatalogRecord[]>([]);
  const [categories, setCategories] = useState<CatalogRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [
        card,
        account,
        cardDescriptors,
        accountDescriptors,
        listedCategories,
        listedAccounts,
        listedParties,
      ] = await Promise.all([
        api.listMovements(bookId, "card", "PENDING"),
        api.listMovements(bookId, "account", "PENDING"),
        api.listCatalog(bookId, "card-descriptors"),
        api.listCatalog(bookId, "account-descriptors"),
        api.listCatalog(bookId, "categories"),
        api.listCatalog(bookId, "accounts"),
        api.listCatalog(bookId, "parties"),
      ]);
      setCategories(listedCategories.items);
      setAccounts(listedAccounts.items);
      setParties(listedParties.items);
      setPlan(
        planPromotion({
          card: card.items,
          account: account.items,
          cardDescriptors: cardDescriptors.items,
          accountDescriptors: accountDescriptors.items,
          categories: listedCategories.items,
        }),
      );
    } catch (cause) {
      setError((cause as Error).message);
      setPlan({ ready: [], blocked: [], readyLines: 0, blockedLines: 0 });
    }
  }, [bookId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (plan) onReadyLines?.(plan.readyLines);
  }, [plan, onReadyLines]);

  const name = useMemo(
    () => ({
      account: (id: string | null) =>
        String(accounts.find((row) => row.id === id)?.name ?? id ?? "—"),
      party: (id: string | null) =>
        String(parties.find((row) => row.id === id)?.name ?? id ?? "—"),
      category: (id: string | null) =>
        String(categories.find((row) => row.id === id)?.name ?? id ?? "—"),
    }),
    [accounts, parties, categories],
  );

  /**
   * Promotes a set of decisions, one line at a time.
   *
   * Sequential on purpose. Card lines on the same invoice share one payment
   * and a day's inflows share one receipt, and the ledger finds those by key
   * before creating them — so posting in parallel races two lines to the same
   * shared record and one of them loses on a unique constraint. Slower, and it
   * gives the progress something true to report.
   *
   * A refusal does not stop the rest: the remaining lines are independent, and
   * the point of the screen is to clear what can be cleared. Every failure is
   * kept with the server's own words.
   */
  async function promote(decisions: readonly ReadyDecision[]) {
    const lines = decisions.flatMap((decision) =>
      decision.lines.map((line) => ({ side: decision.side, line })),
    );
    if (lines.length === 0) return;

    setOutcomes([]);
    setRun({ total: lines.length, done: 0, finished: false });
    const results: Outcome[] = [];

    for (const { side, line } of lines) {
      try {
        const posted = await api.postMovement(
          bookId,
          side,
          line.id,
          referenceMonthOf(line.purchaseDate),
        );
        results.push({ id: line.id, ok: true, becomes: posted.kind });
      } catch (cause) {
        results.push({
          id: line.id,
          ok: false,
          message: (cause as Error).message,
        });
      }
      setRun((current) =>
        current ? { ...current, done: current.done + 1 } : current,
      );
    }

    setOutcomes(results);
    setRun((current) => (current ? { ...current, finished: true } : current));
    // Reload rather than mutate: what is left promotable is a server fact now.
    await load();
  }

  if (error) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!plan) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>;
  }

  const posted = outcomes.filter((outcome) => outcome.ok).length;
  const refused = outcomes.filter((outcome) => !outcome.ok);
  const busy = Boolean(run && !run.finished);

  if (plan.readyLines === 0 && plan.blockedLines === 0) {
    return (
      <div className="max-w-prose space-y-3">
        <p className="text-sm">
          Nada aguardando. Toda linha importada já está no razão.
        </p>
        <p className="text-sm text-muted-foreground">
          Importe um extrato ou uma fatura para ter o que lançar.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-12">
      <section aria-labelledby="ready">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-prose">
            <h2 id="ready">Prontos para lançar</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {plan.readyLines === 0
                ? "Nenhuma decisão fechada ainda. Resolva um descritor na revisão e ele aparece aqui."
                : `${plan.readyLines} ${plan.readyLines === 1 ? "linha" : "linhas"} em ${plan.ready.length} ${plan.ready.length === 1 ? "decisão" : "decisões"}, já com parte e categoria. Cada linha vira um registro no razão.`}
            </p>
          </div>
          {plan.readyLines > 0 ? (
            <Button onClick={() => promote(plan.ready)} disabled={busy}>
              {busy
                ? `Lançando ${run?.done} de ${run?.total}…`
                : `Lançar ${plan.readyLines} ${plan.readyLines === 1 ? "linha" : "linhas"}`}
            </Button>
          ) : null}
        </div>

        {/*
         * A determinate bar, and the only motion on the screen: it answers the
         * click and says how far along a run of eighty-one requests is, which
         * a spinner cannot.
         */}
        {run && !run.finished ? (
          <progress
            value={run.done}
            max={run.total}
            aria-label="Lançando movimentos"
            className="mt-4 h-1 w-full appearance-none overflow-hidden rounded-full bg-muted [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary"
          />
        ) : null}

        {run?.finished ? (
          <output className="mt-4 block space-y-2">
            <p className="text-sm">
              {posted} {posted === 1 ? "linha lançada" : "linhas lançadas"}
              {refused.length > 0
                ? ` · ${refused.length} ${refused.length === 1 ? "recusada" : "recusadas"}`
                : "."}
            </p>
            {/*
             * The server's own words, not a summary of them. A refusal here is
             * the mirror in `promotion.ts` disagreeing with the ledger, and
             * paraphrasing it would hide exactly the sentence that says why.
             */}
            {refused.length > 0 ? (
              <ul className="space-y-1 border-l-2 border-destructive/40 pl-3">
                {refused.map((outcome) => (
                  <li
                    key={outcome.id}
                    className="text-sm text-muted-foreground"
                  >
                    {outcome.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </output>
        ) : null}

        {plan.ready.length > 0 ? (
          <div className="mt-6 space-y-6">
            {(["card", "account"] as const).map((side) => {
              const decisions = plan.ready.filter(
                (decision) => decision.side === side,
              );
              if (decisions.length === 0) return null;
              return (
                <div key={side}>
                  <h3 className="mb-2 text-sm font-medium">{SIDES[side]}</h3>
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {decisions.map((decision) => (
                      <li key={decision.id}>
                        <div className="flex items-center gap-2 px-3 py-2">
                          <button
                            type="button"
                            onClick={() =>
                              setOpen((current) =>
                                current === decision.id ? null : decision.id,
                              )
                            }
                            aria-expanded={open === decision.id}
                            aria-controls={`lines-${decision.id}`}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          >
                            {/*
                             * How many lines this one decision releases. It
                             * leads the row because it is what makes the
                             * decision worth confirming first.
                             */}
                            <span className="tabular w-8 shrink-0 text-right text-sm text-muted-foreground">
                              {decision.lines.length}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm">
                                {decision.counterAccountId
                                  ? `${name.account(decision.accountId)} → ${name.account(decision.counterAccountId)}`
                                  : `${name.party(decision.partyId)} · ${name.category(decision.categoryId)}`}
                              </span>
                              {/* The bank's wording, quoted and never adopted. */}
                              <span className="block truncate font-mono text-xs text-muted-foreground">
                                {decision.descriptorKey}
                              </span>
                            </span>
                            <BecomesChip becomes={decision.becomes} />
                            <span className="tabular w-28 shrink-0 text-right text-sm whitespace-nowrap">
                              {formatStatementAmount(
                                decision.total,
                                decision.lines[0]?.currency ?? "BRL",
                              )}
                            </span>
                          </button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => promote([decision])}
                          >
                            Lançar
                          </Button>
                        </div>

                        {open === decision.id ? (
                          <div
                            id={`lines-${decision.id}`}
                            className="overflow-x-auto border-t border-border bg-muted/40 px-3 py-2"
                          >
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-xs text-muted-foreground">
                                  <th className="py-1 pr-3 font-medium">
                                    {side === "card" ? "Compra" : "Lançamento"}
                                  </th>
                                  <th className="py-1 pr-3 font-medium">
                                    Conta
                                  </th>
                                  <th className="py-1 pr-3 font-medium">
                                    Descrição
                                  </th>
                                  <th className="py-1 text-right font-medium">
                                    Valor
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {decision.lines.map((line: Movement) => (
                                  <tr key={line.id}>
                                    <td className="tabular py-1 pr-3 whitespace-nowrap">
                                      {day(line.purchaseDate)}
                                    </td>
                                    <td className="py-1 pr-3 whitespace-nowrap">
                                      {name.account(line.accountId)}
                                    </td>
                                    <td className="py-1 pr-3">
                                      {line.description}
                                    </td>
                                    <td className="tabular py-1 text-right whitespace-nowrap">
                                      {formatStatementAmount(
                                        line.amount,
                                        line.currency,
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      {plan.blocked.length > 0 ? (
        <section aria-labelledby="blocked">
          <h2 id="blocked">Faltam decidir</h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            {plan.blockedLines} {plan.blockedLines === 1 ? "linha" : "linhas"}{" "}
            que a promoção recusaria hoje, por motivo. Cada motivo se resolve na
            revisão do documento onde a linha entrou.
          </p>
          <ul className="mt-4 divide-y divide-border rounded-md border border-border">
            {plan.blocked.map((reason) => (
              <li
                key={`${reason.side}-${reason.blocker}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2.5"
              >
                <span className="tabular w-8 shrink-0 text-right text-sm text-muted-foreground">
                  {reason.lines}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">
                    {BLOCKERS[reason.blocker].label}
                    <span className="text-muted-foreground">
                      {" — "}
                      {SIDES[reason.side].toLowerCase()}
                      {reason.blocker === "card-credit"
                        ? ""
                        : `, ${reason.descriptors} ${reason.descriptors === 1 ? "descritor" : "descritores"}`}
                    </span>
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {BLOCKERS[reason.blocker].fix}
                  </span>
                </span>
                {onReview && reason.blocker !== "card-credit" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onReview(reason.side)}
                  >
                    Abrir revisão
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
