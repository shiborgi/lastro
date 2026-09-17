"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { type CatalogRecord, api } from "@/lib/api";
import { Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/**
 * The chart of accounts, drawn as the two charts it actually is.
 *
 * This screen replaced a flat table with a "Dentro do grupo" column. The column
 * *stated* each parent; a tree *shows* them, and the shape is the whole point
 * of nesting in the first place.
 *
 * Three things the layout encodes rather than explains:
 *
 * Expense and revenue are split at the top level, because they are separate
 * charts of accounts — the database refuses a child whose kind differs from its
 * parent's, so no branch can ever cross between these two columns.
 *
 * Being a group is not a stored flag. A category becomes a group the moment
 * something is nested inside it, and stops being postable at that moment. So
 * the label is derived from the children on screen, never from a field.
 *
 * A leaf's record count is the evidence for the rule that refuses turning it
 * into a group. "1 lançamento" is why that action is not offered there.
 */

/*
 * The column names the chart, not the kind. "Receitas" alone collided with a
 * group that a Book actually has under that exact name — two different things
 * reading identically on the same screen.
 */
const KINDS = [
  ["EXPENSE", "Plano de despesas"],
  ["REVENUE", "Plano de receitas"],
] as const;

type Kind = (typeof KINDS)[number][0];

/**
 * How many records sit in each category, keyed by parent name and own name.
 *
 * Taken from the summary's own group-by, which counts every posted record
 * rather than a page of them. Keyed on names because that is what the
 * aggregate returns; the pair (group, category) is what makes it unambiguous —
 * a leaf reports its parent's name, a standalone category reports none.
 */
type Usage = Map<string, number>;

function usageKey(group: string | null, category: string): string {
  return `${group ?? ""}\u0000${category}`;
}

function CategoryForm({
  bookId,
  /** The group this will sit inside. Null creates a top-level node. */
  parent,
  kind,
  editing,
  onDone,
  onCancel,
}: {
  bookId: string;
  parent: CatalogRecord | null;
  kind: Kind;
  editing: CatalogRecord | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(editing ? String(editing.name ?? "") : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) {
      setError("Dê um nome à categoria.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await api.updateCatalog(bookId, "categories", editing.id, {
          name: name.trim(),
        });
      } else {
        /*
         * The kind is not asked for. A child's kind has to match its parent's
         * — the database enforces it — so offering the choice would only let
         * the operator pick the one answer that gets rejected.
         */
        await api.createCatalog(bookId, "categories", {
          name: name.trim(),
          kind,
          ...(parent ? { parentId: parent.id } : {}),
        });
      }
      onDone();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed border-border p-2">
      <input
        // biome-ignore lint/a11y/noAutofocus: the operator asked for this field
        autoFocus
        aria-label={
          editing
            ? "Novo nome da categoria"
            : parent
              ? `Nome da categoria em ${String(parent.name)}`
              : "Nome do grupo"
        }
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={parent ? "Aluguel" : "Custos fixos"}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
      />
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={submit}>
          {busy ? "Salvando…" : "Salvar"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export function CategoriesTab({ bookId }: { bookId: string }) {
  const [rows, setRows] = useState<CatalogRecord[] | null>(null);
  const [usage, setUsage] = useState<Usage>(new Map());
  const [error, setError] = useState<string | null>(null);
  /** Which slot has a form open: `new:<parentId|kind>` or `edit:<id>`. */
  const [form, setForm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const listed = await api.listCatalog(bookId, "categories");
      setRows(listed.items);
      // A failed summary costs the counts, not the tree.
      try {
        const insights = await api.getInsights(bookId);
        const counts: Usage = new Map();
        for (const row of insights.byGroup) {
          counts.set(
            usageKey(row.group, row.category),
            (counts.get(usageKey(row.group, row.category)) ?? 0) + row.count,
          );
        }
        setUsage(counts);
      } catch {
        setUsage(new Map());
      }
    } catch (cause) {
      setError((cause as Error).message);
      setRows([]);
    }
  }, [bookId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(record: CatalogRecord) {
    setBusy(record.id);
    setError(null);
    try {
      await api.deleteCatalog(bookId, "categories", record.id);
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (rows === null) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>;
  }

  const childrenOf = (id: string) => rows.filter((row) => row.parentId === id);

  function Actions({ record }: { record: CatalogRecord }) {
    return (
      <span className="flex shrink-0 gap-1">
        <button
          type="button"
          aria-label={`Renomear ${String(record.name)}`}
          onClick={() => setForm(`edit:${record.id}`)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Pencil aria-hidden="true" className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Excluir ${String(record.name)}`}
          disabled={busy === record.id}
          onClick={() => void remove(record)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
        >
          <Trash2 aria-hidden="true" className="size-3.5" />
        </button>
      </span>
    );
  }

  function Leaf({
    record,
    parent,
  }: {
    record: CatalogRecord;
    parent: CatalogRecord | null;
  }) {
    const used =
      usage.get(
        usageKey(parent ? String(parent.name) : null, String(record.name)),
      ) ?? 0;
    return (
      <li className="group/row">
        {form === `edit:${record.id}` ? (
          <CategoryForm
            bookId={bookId}
            parent={parent}
            kind={record.kind as Kind}
            editing={record}
            onDone={() => {
              setForm(null);
              void load();
            }}
            onCancel={() => setForm(null)}
          />
        ) : (
          <div className="flex items-baseline justify-between gap-3 rounded px-2 py-1.5 hover:bg-muted/40">
            <span className="min-w-0 truncate">{String(record.name)}</span>
            <span className="flex shrink-0 items-baseline gap-2">
              <span className="text-xs tabular-nums text-muted-foreground">
                {used > 0
                  ? `${used} ${used === 1 ? "lançamento" : "lançamentos"}`
                  : "—"}
              </span>
              <Actions record={record} />
            </span>
          </div>
        )}
      </li>
    );
  }

  function Node({ record }: { record: CatalogRecord }) {
    const children = childrenOf(record.id);
    const used = usage.get(usageKey(null, String(record.name))) ?? 0;

    // No children: a plain postable category that happens to sit at the top.
    if (children.length === 0) {
      return (
        <div className="rounded-md border border-border bg-card">
          <ul className="p-1">
            <Leaf record={record} parent={null} />
          </ul>
          {/*
           * Nesting turns this into a group, and a group holds no records — so
           * the offer only exists while there is nothing to strand. With
           * records, the count is the explanation.
           */}
          {form === `new:${record.id}` ? (
            <div className="border-t border-dashed border-border p-2">
              <CategoryForm
                bookId={bookId}
                parent={record}
                kind={record.kind as Kind}
                editing={null}
                onDone={() => {
                  setForm(null);
                  void load();
                }}
                onCancel={() => setForm(null)}
              />
            </div>
          ) : used === 0 ? (
            <div className="border-t border-dashed border-border px-3 py-1.5">
              <button
                type="button"
                onClick={() => setForm(`new:${record.id}`)}
                className="text-xs text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                Aninhar uma categoria aqui
              </button>
            </div>
          ) : (
            <p className="border-t border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground">
              Já tem lançamentos, então não pode virar grupo.
            </p>
          )}
        </div>
      );
    }

    return (
      <div className="rounded-md border border-border bg-card">
        <div className="flex items-baseline justify-between gap-3 border-b border-border px-3 py-2">
          {form === `edit:${record.id}` ? (
            <div className="w-full">
              <CategoryForm
                bookId={bookId}
                parent={null}
                kind={record.kind as Kind}
                editing={record}
                onDone={() => {
                  setForm(null);
                  void load();
                }}
                onCancel={() => setForm(null)}
              />
            </div>
          ) : (
            <>
              <span className="min-w-0 truncate font-medium">
                {String(record.name)}
              </span>
              <span className="flex shrink-0 items-baseline gap-2">
                <span className="text-xs text-muted-foreground">
                  grupo · {children.length}{" "}
                  {children.length === 1 ? "categoria" : "categorias"}
                </span>
                <Actions record={record} />
              </span>
            </>
          )}
        </div>
        {/*
         * The rule on the left is the nesting. It runs the height of the
         * children and stops there, so the depth is visible without a label
         * saying "level 2".
         */}
        <ul className="ml-3 border-l border-border p-1 pl-2">
          {children.map((child) => (
            <Leaf key={child.id} record={child} parent={record} />
          ))}
        </ul>
        <div className="border-t border-dashed border-border px-3 py-1.5">
          {form === `new:${record.id}` ? (
            <CategoryForm
              bookId={bookId}
              parent={record}
              kind={record.kind as Kind}
              editing={null}
              onDone={() => {
                setForm(null);
                void load();
              }}
              onCancel={() => setForm(null)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setForm(`new:${record.id}`)}
              className="text-xs text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Adicionar categoria
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-6" aria-label="Categorias">
      <h2>Categorias</h2>

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/*
       * Two columns, not one list. Expense and revenue are separate charts of
       * accounts: the database refuses a child whose kind differs from its
       * parent's, so nothing can ever cross from one column to the other.
       */}
      <div className="grid gap-6 lg:grid-cols-2">
        {KINDS.map(([kind, title]) => {
          const roots = rows.filter(
            (row) => row.kind === kind && !row.parentId,
          );
          return (
            <div key={kind} className="space-y-3">
              <h3 className="text-sm font-medium">{title}</h3>
              {roots.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nada no {title.toLowerCase()} ainda.
                </p>
              ) : (
                <div className="space-y-3">
                  {roots.map((root) => (
                    <Node key={root.id} record={root} />
                  ))}
                </div>
              )}
              {form === `new:${kind}` ? (
                <CategoryForm
                  bookId={bookId}
                  parent={null}
                  kind={kind}
                  editing={null}
                  onDone={() => {
                    setForm(null);
                    void load();
                  }}
                  onCancel={() => setForm(null)}
                />
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setForm(`new:${kind}`)}
                >
                  Adicionar no {title.toLowerCase()}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
        A profundidade é fixa em dois níveis: uma categoria pode ficar dentro de
        um grupo, e um grupo não fica dentro de nada. Lançamentos vão sempre na
        folha — um grupo guarda categorias, nunca registros.
      </p>
    </section>
  );
}
