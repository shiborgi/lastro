/**
 * Creating the counterparty a descriptor is missing, without leaving the
 * bench.
 */
"use client";

import { Button } from "@/components/ui/button";
import { type CatalogRecord, api } from "@/lib/api";
import { slugify } from "@/lib/slug";
import { useState } from "react";
import { PARTY_TYPES } from "./shared";

/**
 * Creating the counterparty without leaving the queue.
 *
 * A descriptor naming a shop the books have never seen is the commonest
 * interruption on this screen. Sending the operator to Cadastro and back costs
 * them their place among sixty-nine decisions, so the party is created here and
 * selected on the spot. The key is derived from the name rather than asked for:
 * it is an identifier, and there is nothing to decide about it here.
 */
export function NewParty({
  bookId,
  suggestion,
  onCreated,
}: {
  bookId: string;
  /** What the statement called it, humanized. */
  suggestion: string;
  onCreated: (party: CatalogRecord) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("COMPANY");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setName(suggestion);
          setType("COMPANY");
          setError(null);
          setOpen(true);
        }}
        className="text-xs text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        Criar parte
      </button>
    );
  }

  const key = slugify(name);

  async function create() {
    if (!name.trim() || !key) {
      setError("Dê um nome à parte.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.createCatalog(bookId, "parties", {
        key,
        name: name.trim(),
        type,
      });
      onCreated(created);
      setOpen(false);
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
        aria-label="Nome da parte"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Nome da parte"
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
      />
      <select
        aria-label="Tipo da parte"
        value={type}
        onChange={(event) => setType(event.target.value)}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
      >
        {PARTY_TYPES.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {/* Shown, not hidden: it is what every other record will point at. */}
      <p className="truncate font-mono text-xs text-muted-foreground">
        {key || "—"}
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
