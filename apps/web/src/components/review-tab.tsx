/**
 * The review bench for one statement kind: lines waiting to become ledger
 * records, and the descriptors that decide what they become.
 *
 * Card and account are separate benches because they are separate questions.
 * A card-invoice line is a charge paid by that card, so its descriptor needs a
 * party and a category and nothing else. An account line also needs the rail
 * the money took, and a transfer needs the account at the other end instead of
 * a party it will never have.
 *
 * The screen is organised around leverage rather than chronology. One
 * descriptor stands for every movement that shares its wording, so deciding
 * `papon_mini_-_mercado_e` once resolves twenty-one lines — and the queue is
 * ordered by how much each decision resolves, with the count leading the row.
 *
 * Two conventions carry the ledger's discipline into the interface:
 *
 * An undecided destination is drawn as a blank to fill, not hidden behind an
 * em dash. The ledger never asserts what it does not know, and the screen says
 * so in the vernacular of the paper form it replaces.
 *
 * The institution's own words are quoted, never adopted. They sit behind a rule
 * as somebody else's claim, because a real invoice files "BRASTEMP BY CULLIGAN"
 * under *Aluguel* and applying that would put a wrong fact on the books.
 */

"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { type CatalogRecord, api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";
import { NewCategory } from "./review/category-form";
import { mappedDescriptors } from "./review/evidence";
import { NewParty } from "./review/party-form";
import {
  Blank,
  type Draft,
  METHODS,
  METHOD_LABEL,
  type Pending,
  accountName,
  countClass,
  day,
  humanize,
  money,
  wantedKind,
} from "./review/shared";

export function ReviewTab({
  bookId,
  side,
  onPending,
}: {
  bookId: string;
  /** Which statement kind this bench reviews. */
  side: "card" | "account";
  /** How many descriptors are still waiting, after every load. */
  onPending?: (count: number) => void;
}) {
  const [mode, setMode] = useState<"pending" | "mapped">("pending");
  const [pendingRows, setPendingRows] = useState<Pending[] | null>(null);
  const [mappedRows, setMappedRows] = useState<Pending[] | null>(null);
  const [parties, setParties] = useState<CatalogRecord[]>([]);
  const [categories, setCategories] = useState<CatalogRecord[]>([]);
  const [accounts, setAccounts] = useState<CatalogRecord[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [queue, catalog, movements, party, category, account] =
        await Promise.all([
          side === "card"
            ? api.listPendingCardDescriptors(bookId)
            : api.listPendingAccountDescriptors(bookId),
          api.listCatalog(
            bookId,
            side === "card" ? "card-descriptors" : "account-descriptors",
          ),
          api.listMovements(bookId, side),
          api.listCatalog(bookId, "parties"),
          api.listCatalog(bookId, "categories"),
          api.listCatalog(bookId, "accounts"),
        ]);
      setPendingRows(queue.items);
      onPending?.(queue.items.length);
      setMappedRows(mappedDescriptors(side, catalog.items, movements.items));
      setParties(party.items);
      setCategories(category.items);
      setAccounts(account.items);
    } catch (cause) {
      setError((cause as Error).message);
      setPendingRows([]);
      setMappedRows([]);
    }
  }, [bookId, side, onPending]);

  useEffect(() => {
    void load();
  }, [load]);

  // A row open under one tab is never the row a switch lands on under the
  // other: a given descriptor id lives in exactly one of the two lists.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the switch itself, not read inside the body.
  useEffect(() => {
    setOpen(null);
  }, [mode]);

  const aliases = mode === "pending" ? pendingRows : mappedRows;

  function draftFor(alias: Pending): Draft {
    return (
      drafts[alias.id] ?? {
        partyId: alias.partyId ?? "",
        categoryId: alias.categoryId ?? "",
        method: alias.method ?? "",
        counterAccountId: alias.counterAccountId ?? "",
        name: alias.name ?? "",
      }
    );
  }

  function edit(alias: Pending, patch: Partial<Draft>) {
    setDrafts((current) => ({
      ...current,
      [alias.id]: { ...draftFor(alias), ...patch },
    }));
  }

  async function save(alias: Pending) {
    const draft = draftFor(alias);
    setBusy(alias.id);
    setError(null);
    try {
      /*
       * Only the fields that side's table has. Sending a method to a card
       * descriptor is refused outright — the contract is strict — so the shape
       * of the request follows the shape of the table.
       */
      await api.updateCatalog(
        bookId,
        side === "card" ? "card-descriptors" : "account-descriptors",
        alias.id,
        side === "card"
          ? {
              partyId: draft.partyId || null,
              categoryId: draft.categoryId || null,
              name: draft.name.trim() || null,
            }
          : {
              partyId: draft.partyId || null,
              categoryId: draft.categoryId || null,
              method: draft.method || null,
              // Naming it is the declaration; clearing it undoes one.
              counterAccountId: draft.counterAccountId || null,
              name: draft.name.trim() || null,
            },
      );
      setOpen(null);
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (aliases === null) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>;
  }

  const movements = aliases.reduce((sum, alias) => sum + alias.movements, 0);

  return (
    <div className="space-y-4">
      {/*
       * Pendentes and Mapeados are the same bench looking at two ends of one
       * list: a descriptor lives in exactly one of them at a time, and moves
       * from the first to the second the moment it gets a party, a category
       * and — on the account side — a method. Mapeados exists because that
       * move used to be one-way: a wrong decision, like the Stone deposit
       * once mapped to the landlord instead, had no screen to correct it on.
       */}
      <div
        role="tablist"
        aria-label="Filtro de descritores"
        className="inline-flex gap-1 rounded-md border border-border p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "pending"}
          onClick={() => setMode("pending")}
          className={cn(
            "rounded-sm px-3 py-1.5 text-sm transition-colors",
            mode === "pending"
              ? "bg-accent font-medium text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50",
          )}
        >
          Pendentes
          {pendingRows && pendingRows.length > 0 ? (
            <span className="ml-1.5 tabular-nums text-xs text-muted-foreground">
              {pendingRows.length}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "mapped"}
          onClick={() => setMode("mapped")}
          className={cn(
            "rounded-sm px-3 py-1.5 text-sm transition-colors",
            mode === "mapped"
              ? "bg-accent font-medium text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50",
          )}
        >
          Mapeados
          {mappedRows && mappedRows.length > 0 ? (
            <span className="ml-1.5 tabular-nums text-xs text-muted-foreground">
              {mappedRows.length}
            </span>
          ) : null}
        </button>
      </div>

      {/*
       * The header states the relationship, not a single figure: the ratio
       * between lines and the decisions that cover them is the whole point of
       * working by descriptor, in either direction — waiting to be resolved,
       * or already resolved and open to correction.
       */}
      <p className="max-w-md text-lg leading-snug">
        <span className="text-3xl font-bold tabular-nums">{movements}</span>{" "}
        {mode === "pending" ? "movimentos aguardam." : "movimentos mapeados."}
        <br />
        <span className="text-3xl font-bold tabular-nums text-primary">
          {aliases.length}
        </span>{" "}
        {mode === "pending"
          ? "decisões os resolvem."
          : "decisões os cobrem — edite qualquer uma."}
      </p>

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {aliases.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {mode === "pending"
            ? side === "card"
              ? "Nada pendente. Todo descritor de fatura tem parte e categoria."
              : "Nada pendente. Todo descritor de extrato tem parte, categoria e método."
            : "Nenhum descritor mapeado ainda."}
        </p>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
          {aliases.map((alias) => {
            const draft = draftFor(alias);
            const expanded = open === alias.id;
            const said = alias.sourceCategories[0]?.value;
            return (
              <div key={alias.id}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : alias.id)}
                  className="grid w-full grid-cols-[3rem_7rem_minmax(0,1fr)] items-baseline gap-x-4 px-4 py-3 text-left hover:bg-muted/40"
                >
                  <span
                    className={`text-right tabular-nums ${countClass(alias.movements)}`}
                  >
                    {alias.movements}
                    <span className="text-xs font-normal text-muted-foreground">
                      ×
                    </span>
                  </span>
                  <span className="text-right font-medium tabular-nums">
                    {money(alias.total)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-[0.8125rem]">
                      {alias.key}
                    </span>
                    {/* The chosen title, once there is one — what the
                        promoted expense or revenue will be called. */}
                    {alias.name ? (
                      <span className="block truncate text-sm font-medium text-foreground">
                        {alias.name}
                      </span>
                    ) : null}
                    {said ? (
                      <span className="mt-1 block truncate border-l-2 border-border pl-2 font-mono text-xs text-muted-foreground">
                        {said}
                      </span>
                    ) : null}
                    <span className="mt-1 flex flex-wrap items-baseline gap-2 text-xs text-muted-foreground">
                      {/*
                       * Where the line happened, first, because the queue
                       * mixes accounts: the C6 statement and the Nubank one
                       * land in the same bench, and the same wording on two
                       * accounts is two descriptors that point opposite ways.
                       * Choosing a destination without seeing the origin is a
                       * guess — the Gelagoela pair is exactly that trap.
                       */}
                      <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
                        {accountName(accounts, alias.accountId)}
                      </span>
                      {alias.partyId ? (
                        <span className="text-foreground">
                          {parties.find((p) => p.id === alias.partyId)?.name ??
                            alias.partyId}
                        </span>
                      ) : (
                        <Blank />
                      )}
                      <span aria-hidden="true">·</span>
                      {alias.categoryId ? (
                        <span className="text-foreground">
                          {categories.find((c) => c.id === alias.categoryId)
                            ?.name ?? alias.categoryId}
                        </span>
                      ) : (
                        <Blank />
                      )}
                      {/* A card descriptor has neither, so the row does not
                          print two blanks that can never be filled. */}
                      {side === "account" ? (
                        <>
                          <span aria-hidden="true">·</span>
                          {alias.method ? (
                            <span className="text-foreground">
                              {METHOD_LABEL.get(alias.method) ?? alias.method}
                            </span>
                          ) : (
                            <Blank />
                          )}
                          {alias.counterAccountId ? (
                            <>
                              <span aria-hidden="true">·</span>
                              {/* The direction, read from the sign: money out
                                  leaves this account, money in arrives in it. */}
                              <span className="text-foreground">
                                {BigInt(alias.total) < 0n
                                  ? `→ ${accountName(accounts, alias.counterAccountId)}`
                                  : `← ${accountName(accounts, alias.counterAccountId)}`}
                              </span>
                            </>
                          ) : null}
                        </>
                      ) : null}
                      <span className="tabular-nums">
                        {day(alias.firstSeen)} – {day(alias.lastSeen)}
                      </span>
                    </span>
                  </span>
                </button>

                {expanded ? (
                  <div className="space-y-3 border-t border-dashed border-border px-4 pt-3 pb-4">
                    <p className="font-mono text-xs break-all text-muted-foreground">
                      {alias.key}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {/*
                       * Hidden once another account is named. Money moving
                       * between two of your own accounts has no counterparty
                       * and nothing to classify, and the promotion ignores
                       * both — leaving them on screen would ask for answers
                       * that get discarded.
                       *
                       * A div rather than a label, because this field carries a
                       * button: clicking a label activates the control it wraps,
                       * so "Criar parte" would open the select instead.
                       */}
                      <div
                        hidden={Boolean(draft.counterAccountId)}
                        className="space-y-1 text-xs text-muted-foreground"
                      >
                        <label htmlFor={`party-${alias.id}`}>parte</label>
                        <select
                          id={`party-${alias.id}`}
                          value={draft.partyId}
                          onChange={(event) =>
                            edit(alias, { partyId: event.target.value })
                          }
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                        >
                          <option value="">—</option>
                          {parties.map((party) => (
                            <option key={party.id} value={party.id}>
                              {party.name}
                            </option>
                          ))}
                        </select>
                        <NewParty
                          bookId={bookId}
                          suggestion={humanize(alias.key)}
                          onCreated={(party) => {
                            setParties((current) => [...current, party]);
                            edit(alias, { partyId: party.id });
                          }}
                        />
                      </div>
                      {/* A div, not a label: it holds a button. See the party
                          field above for why that matters. */}
                      <div
                        hidden={Boolean(draft.counterAccountId)}
                        className="space-y-1 text-xs text-muted-foreground"
                      >
                        <label htmlFor={`category-${alias.id}`}>
                          categoria
                        </label>
                        <select
                          id={`category-${alias.id}`}
                          value={draft.categoryId}
                          onChange={(event) =>
                            edit(alias, { categoryId: event.target.value })
                          }
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                        >
                          <option value="">—</option>
                          {/*
                           * Only the categories this direction can accept.
                           *
                           * Promotion compares the category's kind against the
                           * movement's and refuses a mismatch, so an expense
                           * category on money coming in is the one answer that
                           * cannot work — and it used to be most of the list:
                           * three of the four leaves in a real Book are
                           * expense, so mapping an inflow meant picking wrong
                           * and finding out at promotion. Creating a category
                           * here already followed the direction; choosing one
                           * did not.
                           *
                           * Grouped, and a group is not selectable: it holds
                           * categories, not records, and the database refuses
                           * a record posted to one. Offering it as a choice
                           * would only produce an error later.
                           */}
                          {categories
                            .filter(
                              (category) =>
                                !category.parentId &&
                                category.kind === wantedKind(side, alias.total),
                            )
                            .map((group) => {
                              const children = categories.filter(
                                (category) => category.parentId === group.id,
                              );
                              return children.length === 0 ? (
                                <option key={group.id} value={group.id}>
                                  {String(group.name)}
                                </option>
                              ) : (
                                <optgroup
                                  key={group.id}
                                  label={String(group.name)}
                                >
                                  {children.map((child) => (
                                    <option key={child.id} value={child.id}>
                                      {String(child.name)}
                                    </option>
                                  ))}
                                </optgroup>
                              );
                            })}
                        </select>
                        <NewCategory
                          bookId={bookId}
                          kind={wantedKind(side, alias.total)}
                          groups={categories.filter(
                            (category) =>
                              !category.parentId &&
                              category.kind === wantedKind(side, alias.total),
                          )}
                          onCreated={(category) => {
                            setCategories((current) => [...current, category]);
                            edit(alias, { categoryId: category.id });
                          }}
                        />
                      </div>
                      {/*
                       * A label for the specific expense or revenue this
                       * promotes to — never seeded, like the category above,
                       * because it names one purchase and not the wording the
                       * bank printed. Hidden with party and category: a
                       * transfer becomes neither, so it never carries one.
                       */}
                      <label
                        hidden={Boolean(draft.counterAccountId)}
                        htmlFor={`name-${alias.id}`}
                        className="space-y-1 text-xs text-muted-foreground"
                      >
                        <span>nome</span>
                        <input
                          id={`name-${alias.id}`}
                          value={draft.name}
                          onChange={(event) =>
                            edit(alias, { name: event.target.value })
                          }
                          placeholder={humanize(alias.key)}
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                        />
                      </label>
                      {/*
                       * Method, destination table and the other account exist
                       * only on the account side. A credit-card invoice line
                       * was paid by that card and becomes an expense; there is
                       * nothing to choose, so nothing is shown.
                       */}
                      {side === "account" ? (
                        <>
                          <label className="space-y-1 text-xs text-muted-foreground">
                            <span>método</span>
                            <select
                              value={draft.method}
                              onChange={(event) =>
                                edit(alias, { method: event.target.value })
                              }
                              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                            >
                              <option value="">—</option>
                              {METHODS.map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                          {/*
                           * Naming another account is what declares this a
                           * transfer — there is no separate "kind" to pick.
                           * The statement names the account the money left,
                           * never the one it reached, so this is the one thing
                           * the file cannot tell us.
                           */}
                          <label className="space-y-1 text-xs text-muted-foreground">
                            {/*
                             * The label states the direction rather than
                             * leaving it implied. The sign decides it, and
                             * getting it backwards is the one mistake this
                             * field invites: the same transfer appears on both
                             * statements, and each side names the other.
                             */}
                            <span>
                              {BigInt(alias.total) < 0n
                                ? "foi para outra conta minha"
                                : "veio de outra conta minha"}
                            </span>
                            <select
                              value={draft.counterAccountId}
                              onChange={(event) =>
                                edit(alias, {
                                  counterAccountId: event.target.value,
                                })
                              }
                              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                            >
                              <option value="">— não é</option>
                              {accounts
                                .filter(
                                  (account) => account.id !== alias.accountId,
                                )
                                .map((account) => (
                                  <option key={account.id} value={account.id}>
                                    {account.name}
                                  </option>
                                ))}
                            </select>
                            {/*
                             * Said out loud, because this field competes with
                             * party and category and choosing it hides them.
                             * The label alone read as "name the payer's bank",
                             * which is not what it means — it means one of the
                             * accounts registered in this Book.
                             */}
                            <span className="block text-[0.6875rem] leading-snug">
                              {draft.counterAccountId
                                ? "É transferência: dinheiro seu mudando de lugar, sem parte nem categoria."
                                : "Só entre suas próprias contas. Senão, deixe em “não é”."}
                            </span>
                          </label>
                        </>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        disabled={busy === alias.id}
                        onClick={() => void save(alias)}
                      >
                        {busy === alias.id
                          ? "Salvando…"
                          : `Vale para ${alias.movements} ${alias.movements === 1 ? "movimento" : "movimentos"}`}
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        Todo import futuro deste descritor herda a decisão.
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Ordenado pelo que cada decisão resolve. A categoria citada é a do banco,
        mostrada como evidência e nunca aplicada.
      </p>
    </div>
  );
}
