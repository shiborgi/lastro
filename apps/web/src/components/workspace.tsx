"use client";

import {
  type CatalogGroupSpec,
  CatalogGroupTab,
  type CatalogSpec,
  CatalogTab,
} from "@/components/catalog-tab";
import {
  type LedgerGroupSpec,
  LedgerGroupTab,
  type LedgerSpec,
  LedgerTab,
} from "@/components/ledger-tab";
import { SignIn } from "@/components/sign-in";
import { Summary } from "@/components/summary";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { type Book, api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";

const CATALOGS: readonly CatalogSpec[] = [
  {
    resource: "institutions",
    singular: "institution",
    plural: "Institutions",
    fields: [
      { name: "name", label: "Name", required: true, placeholder: "Acme Bank" },
      {
        name: "key",
        label: "Key",
        required: true,
        slugFrom: "name",
        description: "Suggested from the name. Edit it if you want another.",
      },
    ],
  },
  {
    resource: "accounts",
    singular: "account",
    plural: "Accounts",
    fields: [
      {
        name: "name",
        label: "Name",
        required: true,
        placeholder: "Conta Corrente",
      },
      {
        name: "key",
        label: "Key",
        required: true,
        slugFrom: "name",
        description: "Suggested from the name. Edit it if you want another.",
      },
      {
        name: "type",
        label: "Type",
        required: true,
        options: ["CHECKING", "SAVINGS", "CREDIT_CARD", "CASH", "INVESTMENT"],
      },
      {
        name: "institutionId",
        label: "Institution",
        optionsFrom: "institutions",
        description: "Optional. Pick the institution this account belongs to.",
      },
    ],
  },
  {
    resource: "categories",
    singular: "category",
    plural: "Categories",
    fields: [
      { name: "name", label: "Name", required: true },
      {
        name: "kind",
        label: "Kind",
        required: true,
        options: ["EXPENSE", "REVENUE"],
      },
    ],
  },
];

const CATALOG_GROUPS: readonly CatalogGroupSpec[] = [
  {
    id: "parties",
    title: "Parties",
    resources: [
      {
        resource: "parties",
        singular: "party",
        plural: "Parties",
        fields: [
          {
            name: "name",
            label: "Name",
            required: true,
            placeholder: "Power Co",
          },
          {
            name: "key",
            label: "Key",
            required: true,
            slugFrom: "name",
            description:
              "Suggested from the name. Edit it if you want another.",
          },
          {
            name: "type",
            label: "Type",
            required: true,
            options: ["PERSON", "COMPANY", "GOVERNMENT", "OTHER"],
          },
        ],
      },
      {
        resource: "party-aliases",
        singular: "party alias",
        plural: "Party aliases",
        fields: [
          {
            name: "key",
            label: "Key",
            required: true,
            placeholder: "power-co-checking",
          },
          {
            name: "accountId",
            label: "Account",
            required: true,
            optionsFrom: "accounts",
          },
          {
            name: "partyId",
            label: "Party",
            optionsFrom: "parties",
            description: "Optional. The party this alias resolves to.",
          },
          {
            name: "categoryId",
            label: "Category",
            optionsFrom: "categories",
            description: "Optional. The category this alias resolves to.",
          },
        ],
      },
    ],
  },
];

const LEDGERS: readonly LedgerSpec[] = [
  {
    resource: "transfers",
    title: "Transfers",
    columns: [
      { header: "From", field: "sourceAccountId" },
      { header: "To", field: "destinationAccountId" },
    ],
  },
];

const LEDGER_GROUPS: readonly LedgerGroupSpec[] = [
  {
    id: "expense-cycle",
    title: "Expense cycle",
    resources: [
      { resource: "expenses", title: "Expenses" },
      { resource: "payments", title: "Payments" },
      {
        resource: "expense-settlements",
        title: "Expense settlements",
        columns: [
          { header: "Installment", field: "installmentNumber" },
          { header: "Of", field: "installmentCount" },
        ],
      },
    ],
  },
  {
    id: "revenue-cycle",
    title: "Revenue cycle",
    resources: [
      { resource: "revenues", title: "Revenues" },
      { resource: "receipts", title: "Receipts" },
      { resource: "revenue-settlements", title: "Revenue settlements" },
    ],
  },
];

/*
 * One flat list of destinations in the sidebar, grouped by what they are.
 * Catalog entries are the things you define once; ledger entries are the
 * record streams that reference them.
 */
type View =
  | { kind: "summary" }
  | { kind: "catalog"; spec: CatalogSpec }
  | { kind: "catalog-group"; spec: CatalogGroupSpec }
  | { kind: "ledger"; spec: LedgerSpec }
  | { kind: "ledger-group"; spec: LedgerGroupSpec };

const SUMMARY: View = { kind: "summary" };

function viewKey(view: View): string {
  if (view.kind === "summary") return "summary";
  if (view.kind === "catalog-group") return view.spec.id;
  if (view.kind === "ledger-group") return view.spec.id;
  return view.spec.resource;
}

function viewTitle(view: View): string {
  if (view.kind === "summary") return "Position";
  if (view.kind === "catalog") return view.spec.plural;
  if (view.kind === "catalog-group") return view.spec.title;
  if (view.kind === "ledger-group") return view.spec.title;
  return view.spec.title;
}

type Session =
  | { status: "checking" }
  | { status: "anonymous" }
  | { status: "ready"; books: Book[] };

function NavLink({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
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
      {label}
    </button>
  );
}

export function Workspace() {
  const [session, setSession] = useState<Session>({ status: "checking" });
  const [bookId, setBookId] = useState<string | null>(null);
  const [view, setView] = useState<View>(SUMMARY);

  const load = useCallback(async () => {
    try {
      const result = await api.listBooks();
      setSession({ status: "ready", books: result.books });
      setBookId((current) => current ?? result.books[0]?.id ?? null);
    } catch {
      setSession({ status: "anonymous" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function signOut() {
    await fetch("/api/auth/sign-out", { method: "POST" });
    setSession({ status: "anonymous" });
    setBookId(null);
  }

  if (session.status === "checking") {
    return (
      <main className="p-8">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }

  if (session.status === "anonymous") {
    return <SignIn onSignedIn={load} />;
  }

  const books = session.books;

  return (
    <div className="min-h-screen md:flex">
      {/*
       * Fixed rail on desktop, plain block on mobile: the nav is short enough
       * to scroll past rather than hide behind a menu button.
       */}
      <aside className="border-b border-border bg-popover px-5 py-6 md:fixed md:inset-y-0 md:left-0 md:w-60 md:overflow-y-auto md:border-r md:border-b-0">
        <div className="flex items-center justify-between gap-2 md:block">
          <div>
            <p className="text-lg font-semibold tracking-tight">Lastro</p>
            <p className="eyebrow mt-1">Ledger</p>
          </div>
          <div className="md:hidden">
            <ThemeToggle />
          </div>
        </div>

        <nav className="mt-6 space-y-1" aria-label="Sections">
          <NavLink
            label="Position"
            active={view.kind === "summary"}
            onClick={() => setView(SUMMARY)}
          />

          <p className="eyebrow px-3 pt-4 pb-1">Catalog</p>
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

          <p className="eyebrow px-3 pt-4 pb-1">Records</p>
          {LEDGER_GROUPS.map((spec) => (
            <NavLink
              key={spec.id}
              label={spec.title}
              active={viewKey(view) === spec.id}
              onClick={() => setView({ kind: "ledger-group", spec })}
            />
          ))}
          {LEDGERS.map((spec) => (
            <NavLink
              key={spec.resource}
              label={spec.title}
              active={viewKey(view) === spec.resource}
              onClick={() => setView({ kind: "ledger", spec })}
            />
          ))}
        </nav>
      </aside>

      <main className="w-full px-5 py-8 md:ml-60 md:px-10">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">
              {books.find((book) => book.id === bookId)?.name ?? "Book"}
              {view.kind === "summary" ? "" : ` / ${viewTitle(view)}`}
            </p>
            <h1 className="mt-1">{viewTitle(view)}</h1>
          </div>

          <div className="flex items-center gap-2">
            {books.length > 1 ? (
              <>
                <label htmlFor="book" className="sr-only">
                  Book
                </label>
                <select
                  id="book"
                  value={bookId ?? ""}
                  onChange={(event) => setBookId(event.target.value)}
                  className="h-9 rounded-md border border-input bg-card px-3 text-sm"
                >
                  {books.map((book) => (
                    <option key={book.id} value={book.id}>
                      {book.name}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
            <div className="hidden md:block">
              <ThemeToggle />
            </div>
            <Button size="sm" variant="ghost" onClick={signOut}>
              Sign out
            </Button>
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
        ) : view.kind === "summary" ? (
          <Summary bookId={bookId} />
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
        ) : view.kind === "ledger-group" ? (
          <LedgerGroupTab key={view.spec.id} bookId={bookId} spec={view.spec} />
        ) : (
          <LedgerTab
            key={view.spec.resource}
            bookId={bookId}
            spec={view.spec}
          />
        )}
      </main>
    </div>
  );
}
