"use client";

import { SignIn } from "@/components/sign-in";
import { ThemeToggle } from "@/components/theme-toggle";
/**
 * The application shell: session, Book selection, navigation and the active
 * view. Every screen comes from a registered module; this file names none.
 */
import { coreOperations } from "@lastro/core/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, call } from "./client";
import { type WebModule, createRegistry, groupsOf } from "./registry";

const [listBooks] = coreOperations;

type Book = { id: string; key: string; name: string };
type Session =
  | { status: "checking" }
  | { status: "anonymous"; reason?: string }
  | { status: "ready"; books: Book[] };

export function Shell({ modules }: { modules: readonly WebModule[] }) {
  const registry = useMemo(() => createRegistry(modules), [modules]);
  const [session, setSession] = useState<Session>({ status: "checking" });
  const [bookId, setBookId] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | undefined>(registry.first);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const load = useCallback(async (): Promise<boolean> => {
    try {
      const { items } = await call(listBooks, {});
      setSession({ status: "ready", books: items });
      setBookId((current) => current ?? items[0]?.id ?? null);
      return true;
    } catch (cause) {
      const status = cause instanceof ApiError ? cause.status : 0;
      setSession({
        status: "anonymous",
        reason:
          status === 401 || status === 404
            ? undefined
            : "Não foi possível falar com o razão",
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
    for (const module of registry.modules)
      for (const view of module.views)
        view
          .count?.(bookId)
          .then(
            (value) =>
              active &&
              setCounts((current) => ({ ...current, [view.id]: value })),
          )
          .catch(
            () =>
              active && setCounts((current) => ({ ...current, [view.id]: 0 })),
          );
    return () => {
      active = false;
    };
  }, [bookId, registry]);

  if (session.status === "checking")
    return <p className="p-8 text-sm text-muted-foreground">Carregando…</p>;
  if (session.status === "anonymous")
    return <SignIn onSignedIn={load} reason={session.reason} />;

  const view = viewId ? registry.view(viewId) : undefined;
  return (
    <div className="flex min-h-screen">
      <nav
        aria-label="Módulos"
        className="w-60 shrink-0 border-r p-4 space-y-6"
      >
        <label className="block text-xs text-muted-foreground">
          Book
          <select
            className="mt-1 block w-full rounded border bg-background p-1 text-sm"
            value={bookId ?? ""}
            onChange={(event) => setBookId(event.target.value)}
          >
            {session.books.map((book) => (
              <option key={book.id} value={book.id}>
                {book.name}
              </option>
            ))}
          </select>
        </label>
        {registry.modules.map((module) => (
          <section key={module.id} aria-label={module.label}>
            <h2 className="mb-1 text-xs font-medium uppercase text-muted-foreground">
              {module.label}
            </h2>
            {groupsOf(module).map(({ group, views }) => (
              <div key={group ?? views[0]?.id} className="mb-2">
                {group ? (
                  <h3 className="px-2 pt-1 text-xs text-muted-foreground">
                    {group}
                  </h3>
                ) : null}
                <ul>
                  {views.map((each) => (
                    <li key={each.id}>
                      <button
                        type="button"
                        aria-current={each.id === viewId ? "page" : undefined}
                        className="flex w-full justify-between rounded px-2 py-1 text-left text-sm aria-[current=page]:bg-muted"
                        onClick={() => setViewId(each.id)}
                      >
                        <span>{each.label}</span>
                        {counts[each.id] ? (
                          <span className="tabular text-xs">
                            {counts[each.id]}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
        <ThemeToggle />
      </nav>
      <main className="flex-1 p-8">
        {bookId && view ? (
          view.render({
            bookId,
            navigate: setViewId,
            actions: registry.actionsOf(view.id),
          })
        ) : (
          <p>Nenhum Book disponível.</p>
        )}
      </main>
    </div>
  );
}
