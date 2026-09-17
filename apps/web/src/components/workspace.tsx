"use client";

import { ACCOUNTS, CATALOGS, CATALOG_GROUPS } from "@/components/catalog-specs";
import {
  type CatalogGroupSpec,
  CatalogGroupTab,
  type CatalogSpec,
  CatalogTab,
} from "@/components/catalog-tab";
import { CategoriesTab } from "@/components/categories-tab";
import {
  ExpenseCycleTab,
  RevenueCycleTab,
} from "@/components/financial-cycle-tab";
import { Insights } from "@/components/insights";
import { MovementsTable } from "@/components/movements-table";
import { PostTab } from "@/components/post-tab";
import { ReviewTab } from "@/components/review-tab";
import { SignIn } from "@/components/sign-in";
import { ThemeToggle } from "@/components/theme-toggle";
import { TransferCycleTab } from "@/components/transfer-cycle-tab";
import { Button } from "@/components/ui/button";
import { type Book, api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/**
 * Whether the rail is collapsed, read once at first render.
 *
 * `localStorage` throwing is a real case, not a theoretical one — a private
 * window, or storage blocked outright — and this runs before React has
 * anything to fall back to, so a throw here would blank the page. Default to
 * expanded, the same rail every session has always opened with.
 */
function readCollapsed(): boolean {
  try {
    return localStorage.getItem("lastro:rail-collapsed") === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem("lastro:rail-collapsed", collapsed ? "1" : "0");
  } catch {
    // Nothing to fall back to: the preference just does not persist.
  }
}

/*
 * All three financial cycles used to sit here as flat `LedgerSpec` /
 * `LedgerGroupSpec` tables — Despesas, Pagamentos and Liquidações de despesa
 * (and the revenue-side and transfer-side equivalents) each on their own,
 * with the join between them left to whoever could hold three ids in their
 * head at once. All three moved to their own component — `FinancialCycleTab`
 * for the expense and revenue cycles, `TransferCycleTab` for transfers, which
 * has no settlement to join and instead pairs the two statement lines a
 * transfer is promoted from — each folding the join into whichever side you
 * opened instead of listing it apart. Nothing still needs the generic
 * ledger-table shape, so `ledger-tab.tsx` is gone rather than kept around
 * unused.
 */

/*
 * One flat list of destinations in the sidebar, grouped by what they are.
 * Catalog entries are the things you define once; ledger entries are the
 * record streams that reference them.
 */
type View =
  | { kind: "insights" }
  | { kind: "categories" }
  | { kind: "review"; side: "card" | "account" }
  | { kind: "post" }
  | { kind: "catalog"; spec: CatalogSpec }
  | { kind: "catalog-group"; spec: CatalogGroupSpec }
  | { kind: "expense-cycle" }
  | { kind: "revenue-cycle" }
  | { kind: "transfer-cycle" };

const HOME: View = { kind: "insights" };

function viewKey(view: View): string {
  if (view.kind === "insights") return "insights";
  if (view.kind === "categories") return "categories";
  if (view.kind === "post") return "post";
  if (view.kind === "expense-cycle") return "expense-cycle";
  if (view.kind === "revenue-cycle") return "revenue-cycle";
  if (view.kind === "transfer-cycle") return "transfer-cycle";
  if (view.kind === "review") return `review-${view.side}`;
  if (view.kind === "catalog-group") return view.spec.id;
  return view.spec.resource;
}

function viewTitle(view: View): string {
  if (view.kind === "insights") return "Resumo";
  if (view.kind === "categories") return "Categorias";
  if (view.kind === "post") return "Lançar";
  if (view.kind === "expense-cycle") return "Ciclo de despesa";
  if (view.kind === "revenue-cycle") return "Ciclo de receita";
  if (view.kind === "transfer-cycle") return "Ciclo de transferências";
  if (view.kind === "review") {
    return view.side === "card" ? "Revisão · Fatura" : "Revisão · Extrato";
  }
  if (view.kind === "catalog") return view.spec.plural;
  return view.spec.title;
}

type Session =
  | { status: "checking" }
  /*
   * `reason` carries why the first load failed. Without it a backend that is
   * down, a session the server no longer knows, and a wrong password all end
   * at the same silent sign-in form — the operator retypes a correct password
   * and watches nothing happen. A 401 really is "sign in"; anything else is a
   * failure worth naming.
   */
  | { status: "anonymous"; reason?: string }
  | { status: "ready"; books: Book[] };

function NavLink({
  label,
  active,
  onClick,
  count,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  /** How much work waits behind the link. Absent when there is none. */
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "w-full rounded-md px-3 py-2 text-left text-sm transition-colors",
        "hover:bg-accent hover:text-accent-foreground",
        active
          ? "bg-accent font-medium text-accent-foreground"
          : "text-muted-foreground",
      )}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span>{label}</span>
        {count ? (
          <span className="tabular text-xs text-muted-foreground">{count}</span>
        ) : null}
      </span>
    </button>
  );
}

export function Workspace() {
  const [session, setSession] = useState<Session>({ status: "checking" });
  const [bookId, setBookId] = useState<string | null>(null);
  const [view, setView] = useState<View>(HOME);
  /*
   * The counts on Revisão: the numbers the whole product turns on, visible
   * without opening either screen.
   *
   * Read once per Book here, for someone who lands on Resumo first, and then
   * reported by each review screen itself — it already loads its queue, so the
   * count comes from the same read that drew the list rather than a second
   * request or a re-run trigger.
   */
  const [pendingCard, setPendingCard] = useState(0);
  const [pendingAccount, setPendingAccount] = useState(0);
  /*
   * How many lines are decided and still unposted. Unlike the two above it is
   * not in `insights` — it is a join of movements against their descriptors —
   * so it arrives from the screen that computes it, and stays 0 until then.
   */
  const [readyToPost, setReadyToPost] = useState(0);
  /*
   * Starts expanded — matching every server-rendered page, since Node has no
   * `localStorage` — and syncs to the stored preference right after mount.
   * Reading it eagerly in `useState`'s initializer would make the client's
   * very first render disagree with the server's HTML on a returning
   * visitor who last collapsed it, which React reports as a hydration
   * mismatch. A one-frame settle after mount is the trade, same as the
   * theme toggle takes for the same reason.
   */
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(readCollapsed());
  }, []);
  function toggleRail() {
    setCollapsed((current) => {
      const next = !current;
      writeCollapsed(next);
      return next;
    });
  }

  /**
   * Reads the session. Returns whether it resolved, because the sign-in form
   * calls this and a bare 401 here has two very different meanings: nobody is
   * logged in yet (say nothing) or the credentials were accepted and the
   * session still did not stick (say so — otherwise the button appears dead).
   */
  const load = useCallback(async (): Promise<boolean> => {
    try {
      const result = await api.listBooks();
      setSession({ status: "ready", books: result.books });
      setBookId((current) => current ?? result.books[0]?.id ?? null);
      return true;
    } catch (cause) {
      const status = (cause as { status?: number }).status;
      setSession({
        status: "anonymous",
        reason:
          status === 401 || status === 404
            ? undefined
            : ((cause as Error).message ??
              "Não foi possível falar com o razão"),
      });
      return false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!bookId) return;
    let active = true;
    api
      .getInsights(bookId)
      .then((insights) => {
        if (!active) return;
        setPendingCard(insights.gap.cardDescriptorsPending);
        setPendingAccount(insights.gap.accountDescriptorsPending);
      })
      .catch(() => {
        if (!active) return;
        setPendingCard(0);
        setPendingAccount(0);
      });
    return () => {
      active = false;
    };
  }, [bookId]);

  async function signOut() {
    await fetch("/api/auth/sign-out", { method: "POST" });
    setSession({ status: "anonymous" });
    setBookId(null);
  }

  if (session.status === "checking") {
    return (
      <main className="p-8">
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </main>
    );
  }

  if (session.status === "anonymous") {
    return <SignIn onSignedIn={load} reason={session.reason} />;
  }

  const books = session.books;

  return (
    <div className="min-h-screen md:flex">
      {/*
       * Fixed rail on desktop, plain block on mobile: the nav is short enough
       * to scroll past rather than hide behind a menu button. Collapsing is a
       * desktop-only affordance for the same reason — there is no permanent
       * rail on mobile competing with the content for width, so there is
       * nothing there to collapse.
       */}
      <aside
        className={cn(
          "border-b border-border bg-popover px-5 py-6",
          collapsed
            ? "md:hidden"
            : "md:fixed md:inset-y-0 md:left-0 md:w-60 md:overflow-y-auto md:border-r md:border-b-0",
        )}
      >
        {/*
         * The Book sits at the top of the rail and never moves, because it is
         * identity rather than a filter: the difference between posting to a
         * person and posting to one of their companies. Tucked into a page
         * header it would be one glance away from a record on the wrong books.
         */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {books.length > 1 ? (
              <>
                <label htmlFor="book" className="sr-only">
                  Book
                </label>
                <select
                  id="book"
                  value={bookId ?? ""}
                  onChange={(event) => setBookId(event.target.value)}
                  className="-ml-1 w-full max-w-full truncate rounded-md bg-transparent px-1 py-0.5 text-lg font-semibold tracking-tight hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {books.map((book) => (
                    <option key={book.id} value={book.id}>
                      {book.name}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <p className="truncate text-lg font-semibold tracking-tight">
                {books.find((book) => book.id === bookId)?.name ?? "Book"}
              </p>
            )}
            <p className="mt-0.5 text-xs text-muted-foreground">Lastro</p>
          </div>
          <div className="md:hidden">
            <ThemeToggle />
          </div>
        </div>

        <nav className="mt-6 space-y-1" aria-label="Sections">
          <NavLink
            label="Resumo"
            active={view.kind === "insights"}
            onClick={() => setView({ kind: "insights" })}
          />

          {/*
           * Revisão is two benches, not one screen with a filter. The two
           * statement kinds ask different questions — an invoice line needs a
           * party and a category, a statement line also needs the rail it took
           * — and the counts are what the operator is actually choosing
           * between when deciding where to spend the next ten minutes.
           */}
          <p className="px-3 pt-5 pb-1 text-xs font-medium text-muted-foreground">
            Revisão
          </p>
          <NavLink
            label="Fatura"
            count={pendingCard}
            active={view.kind === "review" && view.side === "card"}
            onClick={() => setView({ kind: "review", side: "card" })}
          />
          <NavLink
            label="Extrato"
            count={pendingAccount}
            active={view.kind === "review" && view.side === "account"}
            onClick={() => setView({ kind: "review", side: "account" })}
          />
          {/*
           * Third under Revisão because it is genuinely third: a line is
           * mapped on one of the two benches above and then posted here. The
           * count is what is decided and still waiting, which is the number
           * that says whether this screen has anything for you today.
           */}
          <NavLink
            label="Lançar"
            count={readyToPost}
            active={view.kind === "post"}
            onClick={() => setView({ kind: "post" })}
          />

          <p className="px-3 pt-5 pb-1 text-xs font-medium text-muted-foreground">
            Cadastro
          </p>
          {CATALOG_GROUPS.map((spec) => (
            <NavLink
              key={spec.id}
              label={spec.title}
              active={viewKey(view) === spec.id}
              onClick={() => setView({ kind: "catalog-group", spec })}
            />
          ))}
          {CATALOGS.map((spec) => (
            <NavLink
              key={spec.resource}
              label={spec.plural}
              active={viewKey(view) === spec.resource}
              onClick={() => setView({ kind: "catalog", spec })}
            />
          ))}
          {/*
           * Categories get their own screen rather than the generic catalog
           * table: the chart of accounts nests, and a table with a "parent"
           * column states the shape instead of showing it.
           */}
          <NavLink
            label="Categorias"
            active={view.kind === "categories"}
            onClick={() => setView({ kind: "categories" })}
          />

          <p className="px-3 pt-5 pb-1 text-xs font-medium text-muted-foreground">
            Razão
          </p>
          <NavLink
            label="Ciclo de despesa"
            active={view.kind === "expense-cycle"}
            onClick={() => setView({ kind: "expense-cycle" })}
          />
          <NavLink
            label="Ciclo de receita"
            active={view.kind === "revenue-cycle"}
            onClick={() => setView({ kind: "revenue-cycle" })}
          />
          <NavLink
            label="Ciclo de transferências"
            active={view.kind === "transfer-cycle"}
            onClick={() => setView({ kind: "transfer-cycle" })}
          />
        </nav>
      </aside>

      <main
        className={cn(
          "w-full px-5 py-8 md:px-10",
          collapsed ? "md:ml-0" : "md:ml-60",
        )}
      >
        {/*
         * The title alone. The line above it used to repeat the Book and the
         * section name in tracked capitals — a label saying what the heading
         * beside it already says.
         */}
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {/*
             * Lives here, not inside the rail: when collapsed, the rail is
             * gone, and the one place still on screen to bring it back is
             * this header. Desktop-only, alongside the rail it controls.
             */}
            <Button
              variant="outline"
              size="sm"
              onClick={toggleRail}
              aria-label={
                collapsed ? "Mostrar barra lateral" : "Recolher barra lateral"
              }
              className="hidden md:inline-flex"
            >
              {collapsed ? (
                <PanelLeftOpen aria-hidden="true" className="size-4" />
              ) : (
                <PanelLeftClose aria-hidden="true" className="size-4" />
              )}
            </Button>
            <h1>{viewTitle(view)}</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden md:block">
              <ThemeToggle />
            </div>
            <button
              type="button"
              onClick={signOut}
              className="h-9 rounded-md border border-border px-3 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Sair
            </button>
          </div>
        </header>

        {books.length === 0 || !bookId ? (
          <p className="text-sm text-muted-foreground">
            No Book is available for this account. Run{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              bun run bootstrap
            </code>{" "}
            to create one.
          </p>
        ) : view.kind === "insights" ? (
          <Insights
            bookId={bookId}
            onReview={() => setView({ kind: "review", side: "account" })}
          />
        ) : view.kind === "categories" ? (
          <CategoriesTab bookId={bookId} />
        ) : view.kind === "expense-cycle" ? (
          <ExpenseCycleTab bookId={bookId} />
        ) : view.kind === "revenue-cycle" ? (
          <RevenueCycleTab bookId={bookId} />
        ) : view.kind === "post" ? (
          <PostTab
            bookId={bookId}
            onReadyLines={setReadyToPost}
            onReview={(side) => setView({ kind: "review", side })}
          />
        ) : view.kind === "review" ? (
          /*
           * Both halves of one bench: the descriptors that decide, and the
           * rows the decisions apply to. `key` remounts on a side change so
           * neither half keeps the other side's data on screen.
           */
          <div key={view.side} className="space-y-8">
            <ReviewTab
              bookId={bookId}
              side={view.side}
              onPending={
                view.side === "card" ? setPendingCard : setPendingAccount
              }
            />
            <MovementsTable bookId={bookId} side={view.side} />
          </div>
        ) : view.kind === "catalog" ? (
          <CatalogTab
            key={view.spec.resource}
            bookId={bookId}
            spec={view.spec}
          />
        ) : view.kind === "catalog-group" ? (
          <CatalogGroupTab
            key={view.spec.id}
            bookId={bookId}
            spec={view.spec}
          />
        ) : (
          <TransferCycleTab bookId={bookId} />
        )}
      </main>
    </div>
  );
}
