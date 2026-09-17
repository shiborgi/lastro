/**
 * Creating the category a descriptor is missing.
 *
 * The chart of accounts nests exactly one level and a group holds no records,
 * so the group list is filtered to the kind the movement's direction demands —
 * the database refuses a child whose kind differs from its parent's.
 */
"use client";

import { Button } from "@/components/ui/button";
import { type CatalogRecord, api } from "@/lib/api";
import { useState } from "react";
import { NewParty } from "./party-form";
import { money } from "./shared";

/**
 * Creating the category without leaving the queue.
 *
 * The counterpart to `NewParty`, with one deliberate difference: the name is
 * **not** seeded from anything on screen. A descriptor's key is what the bank
 * printed about the counterparty, so reading it is reading the file — but the
 * bank's category is a *classification*, and adopting it is exactly what this
 * screen refuses to do. It stays quoted beside the field as evidence.
 *
 * The kind is shown, never asked: it follows the movement's direction. The
 * group list is filtered to that kind for the same reason — the database
 * refuses a child whose kind differs from its parent's.
 */
export function NewCategory({
  bookId,
  kind,
  groups,
  onCreated,
}: {
  bookId: string;
  kind: "EXPENSE" | "REVENUE";
  /** Parentless categories of this kind. Any of them may hold a child. */
  groups: CatalogRecord[];
  onCreated: (category: CatalogRecord) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setName("");
          setParentId("");
          setError(null);
          setOpen(true);
        }}
        className="text-xs text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        Criar categoria
      </button>
    );
  }

  async function create() {
    if (!name.trim()) {
      setError("Dê um nome à categoria.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.createCatalog(bookId, "categories", {
        name: name.trim(),
        kind,
        ...(parentId ? { parentId } : {}),
      });
      onCreated(created);
      setOpen(false);
    } catch (cause) {
      // A group that already holds records is refused by the database, not by
      // this form: the rule lives there and the message comes from there.
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
        aria-label="Nome da categoria"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={kind === "EXPENSE" ? "Insumos" : "Vendas cartão"}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
      />
      <label className="block space-y-1 text-xs text-muted-foreground">
        <span>dentro de</span>
        <select
          aria-label="Grupo da categoria"
          value={parentId}
          onChange={(event) => setParentId(event.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
        >
          <option value="">nenhum grupo</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {String(group.name)}
            </option>
          ))}
        </select>
      </label>
      {/* Shown, not asked: it follows the direction of the money. */}
      <p className="text-xs text-muted-foreground">
        {kind === "EXPENSE" ? "Categoria de despesa" : "Categoria de receita"}
      </p>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => void create()}
        >
          {busy ? "Criando…" : "Criar"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setOpen(false)}
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}
