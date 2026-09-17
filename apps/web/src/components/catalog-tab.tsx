"use client";
import { slugify } from "@/lib/slug";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type CatalogRecord, api } from "@/lib/api";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

export type CatalogField = {
  name: string;
  label: string;
  required?: boolean;
  /**
   * Fixed set of accepted values as `[value, label]`, rendered as a select.
   * The two are separate because the value is the enum member the API stores
   * and the label is what the operator reads.
   */
  options?: readonly (readonly [value: string, label: string])[];
  /**
   * Set when the record is created and never changed afterwards. The field is
   * shown while editing, so the operator can read it, but is not submitted —
   * some keys are derived from data outside this screen and renaming them
   * silently breaks what points at them.
   */
  createOnly?: boolean;
  /**
   * Shown as a column and offered while editing, but not on the create form,
   * because the create path does not persist it. Offering it there would take
   * the operator's answer and drop it without a word.
   */
  editOnly?: boolean;
  /**
   * Render a select populated from another catalog resource. The stored value
   * is the referenced record's id; the label shown is its name.
   */
  optionsFrom?: string;
  placeholder?: string;
  /**
   * Fill this field with the slugified value of another field while the user
   * has not typed here themselves. Suggestion only — never overwrites input.
   */
  slugFrom?: string;
  /**
   * A calendar date. Rendered as a date picker and converted at this edge: the
   * wire carries ISO timestamps, and an operator should never be typing
   * `2026-09-01T00:00:00.000Z` into a text box to say "the first of September".
   */
  date?: boolean;
  description?: string;
};

/** `2026-09-01T00:00:00.000Z` → `2026-09-01`, for a date input's value. */
function dateValue(raw: string): string {
  return raw.slice(0, 10);
}

/** `2026-09-01` → the instant the wire expects, at UTC midnight. */
function dateToIso(raw: string): string {
  return `${raw}T00:00:00.000Z`;
}

export type CatalogSpec = {
  /** Path segment on the API, e.g. "accounts". */
  resource: string;
  singular: string;
  plural: string;
  fields: readonly CatalogField[];
};

export type CatalogGroupSpec = {
  /** Stable key for the sidebar view, e.g. "parties". */
  id: string;
  title: string;
  resources: readonly CatalogSpec[];
};

type Mode =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; record: CatalogRecord }
  | { kind: "delete"; record: CatalogRecord };

function fieldValue(record: CatalogRecord, field: string): string {
  const value = (record as Record<string, unknown>)[field];
  return value == null ? "" : String(value);
}

function referencedName(
  record: CatalogRecord,
  field: CatalogField,
  options: Record<string, CatalogRecord[]>,
): string {
  const id = fieldValue(record, field.name);
  if (!id || !field.optionsFrom) return id;
  const match = options[field.optionsFrom]?.find((item) => item.id === id);
  return match?.name ?? id;
}

/*
 * A value the field declares gets its label; one it does not is shown as
 * itself. A stored value missing from the list means the screen has drifted
 * from the contract, and printing it raw says so instead of hiding it.
 */
function choiceLabel(field: CatalogField, value: string): string {
  return field.options?.find(([option]) => option === value)?.[1] ?? value;
}

function CatalogTable({
  bookId,
  spec,
}: {
  bookId: string;
  spec: CatalogSpec;
}) {
  const [rows, setRows] = useState<CatalogRecord[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "closed" });
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<Record<string, CatalogRecord[]>>({});

  /*
   * Derived fields (the key) are controlled so a suggestion can be written
   * into them as the name is typed. `touched` records the ones the operator
   * edited themselves, which are never overwritten afterwards — a suggestion
   * that fights the typist is worse than no suggestion.
   */
  const [derived, setDerived] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  function editDerived(name: string, value: string) {
    setDerived((current) => ({ ...current, [name]: value }));
    setTouched((current) => ({ ...current, [name]: true }));
  }

  function fillSlugsFrom(source: string, value: string) {
    const suggestion = slugify(value);
    setDerived((current) => {
      const next = { ...current };
      for (const field of spec.fields) {
        if (field.slugFrom === source && !touched[field.name]) {
          next[field.name] = suggestion;
        }
      }
      return next;
    });
  }

  const load = useCallback(async () => {
    try {
      setListError(null);
      const result = await api.listCatalog(bookId, spec.resource);
      setRows(result.items);
    } catch (error) {
      setListError((error as Error).message);
      setRows([]);
    }
  }, [bookId, spec.resource]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * Fields that reference another catalog resource load that resource once and
   * render a select of its names. A failed load leaves the field empty rather
   * than blocking the whole form.
   */
  useEffect(() => {
    const resources = new Set(
      spec.fields
        .map((field) => field.optionsFrom)
        .filter((resource): resource is string => Boolean(resource)),
    );
    for (const resource of resources) {
      if (options[resource]) continue;
      api
        .listCatalog(bookId, resource)
        .then((result) =>
          setOptions((current) => ({ ...current, [resource]: result.items })),
        )
        .catch(() => setOptions((current) => ({ ...current, [resource]: [] })));
    }
  }, [bookId, spec, options]);

  const close = () => {
    setMode({ kind: "closed" });
    setFormError(null);
    setDerived({});
    setTouched({});
  };

  /*
   * Opening the form seeds the derived fields: empty for a new record, and the
   * record's own values when editing — where they count as already touched, so
   * renaming a thing never silently rewrites the key other records use to
   * refer to it.
   */
  function openForm(next: Mode) {
    const seed: Record<string, string> = {};
    const seedTouched: Record<string, boolean> = {};
    for (const field of spec.fields) {
      if (!field.slugFrom) continue;
      if (next.kind === "edit") {
        seed[field.name] = fieldValue(next.record, field.name);
        seedTouched[field.name] = true;
      } else {
        seed[field.name] = "";
      }
    }
    setDerived(seed);
    setTouched(seedTouched);
    setFormError(null);
    setMode(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode.kind !== "create" && mode.kind !== "edit") return;
    const data = new FormData(event.currentTarget);

    const body: Record<string, string> = {};
    for (const field of spec.fields) {
      // A create-only field is not part of a PATCH: the contract rejects it
      // outright, so sending it would fail the whole edit.
      if (mode.kind === "edit" && field.createOnly) continue;
      if (mode.kind === "create" && field.editOnly) continue;
      const raw = String(data.get(field.name) ?? "").trim();
      // On edit an untouched field is simply omitted, so PATCH stays partial.
      if (raw) body[field.name] = field.date ? dateToIso(raw) : raw;
      else if (mode.kind === "create" && field.required) {
        setFormError(`${field.label} é obrigatório`);
        return;
      }
    }

    setBusy(true);
    setFormError(null);
    try {
      if (mode.kind === "create") {
        await api.createCatalog(bookId, spec.resource, body);
      } else {
        await api.updateCatalog(bookId, spec.resource, mode.record.id, body);
      }
      close();
      await load();
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(record: CatalogRecord) {
    setBusy(true);
    setFormError(null);
    try {
      await api.deleteCatalog(bookId, spec.resource, record.id);
      close();
      await load();
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const editing = mode.kind === "edit" ? mode.record : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-medium text-muted-foreground">
          {spec.plural}
        </h3>
        <Button size="sm" onClick={() => openForm({ kind: "create" })}>
          <Plus aria-hidden="true" className="size-4" />
          Adicionar {spec.singular}
        </Button>
      </div>

      {listError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{listError}</AlertDescription>
        </Alert>
      ) : null}

      {rows === null ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nada cadastrado ainda.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {spec.fields.map((field) => (
                  <TableHead key={field.name}>{field.label}</TableHead>
                ))}
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  {spec.fields.map((field) => (
                    <TableCell key={field.name}>
                      {field.optionsFrom
                        ? referencedName(row, field, options) || "—"
                        : field.date
                          ? dateValue(fieldValue(row, field.name)) || "—"
                          : choiceLabel(field, fieldValue(row, field.name)) ||
                            "—"}
                    </TableCell>
                  ))}
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Editar ${row.name}`}
                        onClick={() => openForm({ kind: "edit", record: row })}
                      >
                        <Pencil aria-hidden="true" className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        aria-label={`Excluir ${row.name}`}
                        onClick={() => setMode({ kind: "delete", record: row })}
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={mode.kind === "create" || mode.kind === "edit"}
        onOpenChange={(open) => !open && close()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {mode.kind === "edit" ? "Editar" : "Adicionar"} {spec.singular}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            {spec.fields
              .filter((field) => editing || !field.editOnly)
              .map((field) => (
                <div key={field.name} className="space-y-1">
                  <Label htmlFor={`${spec.resource}-${field.name}`}>
                    {field.label}
                  </Label>
                  {field.options ? (
                    <select
                      id={`${spec.resource}-${field.name}`}
                      name={field.name}
                      disabled={Boolean(editing && field.createOnly)}
                      defaultValue={
                        editing
                          ? fieldValue(editing, field.name)
                          : field.required
                            ? field.options[0]?.[0]
                            : ""
                      }
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
                    >
                      {field.required ? null : <option value="">—</option>}
                      {field.options.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                      {/*
                       * A stored value the field does not list would otherwise
                       * fall back to the first option: the select would show a
                       * type the record does not have, and saving would write it.
                       * That is exactly how the account form came to offer
                       * CHECKING for an ACCOUNT. Showing the real value keeps the
                       * drift visible instead of writing over it.
                       */}
                      {editing &&
                      fieldValue(editing, field.name) &&
                      !field.options.some(
                        ([value]) => value === fieldValue(editing, field.name),
                      ) ? (
                        <option value={fieldValue(editing, field.name)}>
                          {fieldValue(editing, field.name)}
                        </option>
                      ) : null}
                    </select>
                  ) : field.optionsFrom ? (
                    <select
                      id={`${spec.resource}-${field.name}`}
                      name={field.name}
                      defaultValue={
                        editing ? fieldValue(editing, field.name) : ""
                      }
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">—</option>
                      {(options[field.optionsFrom] ?? []).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  ) : field.slugFrom ? (
                    <Input
                      id={`${spec.resource}-${field.name}`}
                      name={field.name}
                      placeholder={field.placeholder}
                      value={derived[field.name] ?? ""}
                      onChange={(event) =>
                        editDerived(field.name, event.target.value)
                      }
                    />
                  ) : field.date ? (
                    <Input
                      id={`${spec.resource}-${field.name}`}
                      name={field.name}
                      type="date"
                      disabled={Boolean(editing && field.createOnly)}
                      defaultValue={
                        editing
                          ? dateValue(fieldValue(editing, field.name))
                          : ""
                      }
                    />
                  ) : (
                    <Input
                      id={`${spec.resource}-${field.name}`}
                      name={field.name}
                      placeholder={field.placeholder}
                      disabled={Boolean(editing && field.createOnly)}
                      defaultValue={
                        editing ? fieldValue(editing, field.name) : ""
                      }
                      onChange={(event) =>
                        fillSlugsFrom(field.name, event.target.value)
                      }
                    />
                  )}
                  {field.description ? (
                    <p className="text-xs text-muted-foreground">
                      {field.description}
                    </p>
                  ) : null}
                </div>
              ))}

            {formError ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Salvando…" : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={mode.kind === "delete"}
        onOpenChange={(open) => !open && close()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir {spec.singular}</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            {mode.kind === "delete"
              ? `Excluir "${mode.record.name}"? Registros que apontam para ele impedem a exclusão.`
              : null}
          </p>
          {formError ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => mode.kind === "delete" && remove(mode.record)}
            >
              {busy ? "Excluindo…" : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function CatalogTab({
  bookId,
  spec,
}: {
  bookId: string;
  spec: CatalogSpec;
}) {
  return (
    <section className="space-y-4" aria-label={spec.plural}>
      <h2>{spec.plural}</h2>
      <CatalogTable bookId={bookId} spec={spec} />
    </section>
  );
}

export function CatalogGroupTab({
  bookId,
  spec,
}: {
  bookId: string;
  spec: CatalogGroupSpec;
}) {
  return (
    <section className="space-y-6" aria-label={spec.title}>
      <h2>{spec.title}</h2>
      {spec.resources.map((resource) => (
        <CatalogTable key={resource.resource} bookId={bookId} spec={resource} />
      ))}
    </section>
  );
}
