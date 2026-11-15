"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { formatStatementAmount, parseTypedAmount } from "@/lib/money";
import { slugify } from "@/lib/slug";
/**
 * One screen for any catalog resource published with `defineCrudOperations`:
 * a table of the Book's records, a form to create or change one, and a
 * confirmed delete. A module declares the fields; this does the rest, so two
 * catalogs cannot behave differently by accident.
 *
 * Each open form holds one idempotency key, reused when the operator retries
 * a failed save, so a dropped answer never writes twice.
 */
import type { CrudOperations, OperationDescriptor } from "@lastro/kernel";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { call, newIdempotencyKey } from "./client";

type Row = { id: string } & Record<string, unknown>;

export type Choice = readonly [value: string, label: string];

export type Field = {
  name: string;
  label: string;
  required?: boolean;
  kind?: "text" | "select" | "reference" | "amount" | "date" | "boolean";
  /** `select`: the values the contract accepts, with what the operator reads. */
  options?: readonly Choice[];
  /** `reference`: where the choices come from, and how each one reads. */
  reference?: {
    list: OperationDescriptor;
    filter?: Record<string, unknown>;
    label: (row: Row) => string;
  };
  /** Suggest this field's value from another one, until the operator edits it. */
  slugFrom?: string;
  placeholder?: string;
  description?: string;
  /** Shown in the table; defaults to true. */
  column?: boolean;
  /** Changeable after creation; defaults to true. */
  editable?: boolean;
};

export type ResourceSpec = {
  title: string;
  singular: string;
  operations: CrudOperations;
  fields: readonly Field[];
  /** Input for the list operation, such as a filter. */
  filter?: Record<string, unknown>;
};

type Mode =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; row: Row }
  | { kind: "delete"; row: Row };

const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Não foi possível concluir";

/** A record's value as the form shows it. */
function formValue(field: Field, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (field.kind === "amount")
    return formatStatementAmount(String(value)).replace(/\./g, "");
  if (field.kind === "boolean") return value ? "true" : "false";
  return String(value);
}

/** The form's text as the contract takes it; `undefined` leaves the field out. */
function wireValue(field: Field, text: string): unknown {
  if (text === "") return field.kind === "text" && field.required ? "" : null;
  if (field.kind === "amount")
    return parseTypedAmount(text, "BRL") ?? Number.NaN;
  if (field.kind === "boolean") return text === "true";
  return text;
}

export function ResourceScreen({
  bookId,
  spec,
}: { bookId: string; spec: ResourceSpec }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "closed" });
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const [choices, setChoices] = useState<Record<string, Row[]>>({});

  const load = useCallback(async () => {
    try {
      const result = (await call(spec.operations.list, spec.filter ?? {}, {
        bookId,
      })) as { items: Row[] };
      setRows(result.items);
      setListError(null);
    } catch (cause) {
      setListError(message(cause));
    }
  }, [bookId, spec]);

  useEffect(() => {
    void load();
  }, [load]);

  const references = useMemo(
    () => spec.fields.filter((field) => field.kind === "reference"),
    [spec],
  );
  useEffect(() => {
    let active = true;
    for (const field of references) {
      const reference = field.reference;
      if (!reference) continue;
      call(reference.list, reference.filter ?? {}, { bookId })
        .then(
          (result) =>
            active &&
            setChoices((current) => ({
              ...current,
              [field.name]: (result as { items: Row[] }).items,
            })),
        )
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [bookId, references]);

  function open(next: Mode) {
    setFormError(null);
    setTouched({});
    setKey(newIdempotencyKey());
    setValues(
      next.kind === "edit"
        ? Object.fromEntries(
            spec.fields.map((field) => [
              field.name,
              formValue(field, next.row[field.name]),
            ]),
          )
        : {},
    );
    setMode(next);
  }

  function change(field: Field, text: string) {
    setTouched((current) => ({ ...current, [field.name]: true }));
    setValues((current) => {
      const next = { ...current, [field.name]: text };
      for (const other of spec.fields)
        if (
          other.slugFrom === field.name &&
          !touched[other.name] &&
          mode.kind === "create"
        )
          next[other.name] = slugify(text);
      return next;
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (mode.kind !== "create" && mode.kind !== "edit") return;
    const input: Record<string, unknown> = {};
    for (const field of spec.fields) {
      if (
        mode.kind === "edit" &&
        (field.editable === false || !touched[field.name])
      )
        continue;
      const text = values[field.name] ?? "";
      if (mode.kind === "create" && text === "" && !field.required) continue;
      const value = wireValue(field, text);
      if (Number.isNaN(value)) {
        setFormError(`${field.label}: valor inválido`);
        return;
      }
      input[field.name] = value;
    }
    setBusy(true);
    try {
      await call(
        mode.kind === "create"
          ? spec.operations.create
          : spec.operations.update,
        mode.kind === "edit" ? { ...input, id: mode.row.id } : input,
        { bookId, idempotencyKey: key },
      );
      setMode({ kind: "closed" });
      await load();
    } catch (cause) {
      setFormError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (mode.kind !== "delete") return;
    setBusy(true);
    try {
      await call(
        spec.operations.remove,
        { id: mode.row.id },
        { bookId, idempotencyKey: key },
      );
      setMode({ kind: "closed" });
      await load();
    } catch (cause) {
      setFormError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  function display(field: Field, row: Row): string {
    const value = row[field.name];
    if (value === null || value === undefined || value === "") return "—";
    if (field.kind === "amount") return formatStatementAmount(String(value));
    if (field.kind === "boolean") return value ? "Sim" : "Não";
    if (field.kind === "select")
      return (
        field.options?.find(([option]) => option === value)?.[1] ??
        String(value)
      );
    if (field.kind === "reference") {
      const found = choices[field.name]?.find((each) => each.id === value);
      return found && field.reference
        ? field.reference.label(found)
        : String(value);
    }
    return String(value);
  }

  const columns = spec.fields.filter((field) => field.column !== false);
  const editing = mode.kind === "create" || mode.kind === "edit";

  return (
    <section aria-label={spec.title} className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{spec.title}</h1>
        <Button onClick={() => open({ kind: "create" })}>
          Nova {spec.singular}
        </Button>
      </header>
      {listError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{listError}</AlertDescription>
        </Alert>
      ) : null}
      {rows === null && !listError ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : null}
      {rows && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum registro ainda.</p>
      ) : null}
      {rows && rows.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((field) => (
                <TableHead key={field.name}>{field.label}</TableHead>
              ))}
              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                {columns.map((field) => (
                  <TableCell
                    key={field.name}
                    className={
                      field.kind === "amount" ? "tabular text-right" : undefined
                    }
                  >
                    {display(field, row)}
                  </TableCell>
                ))}
                <TableCell className="space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => open({ kind: "edit", row })}
                    aria-label={`Editar ${columns[0] ? display(columns[0], row) : row.id}`}
                  >
                    Editar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => open({ kind: "delete", row })}
                    aria-label={`Excluir ${columns[0] ? display(columns[0], row) : row.id}`}
                  >
                    Excluir
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      <Dialog
        open={editing}
        onOpenChange={(isOpen) => !isOpen && setMode({ kind: "closed" })}
      >
        <DialogContent>
          <form onSubmit={save} className="space-y-4">
            <DialogHeader>
              <DialogTitle>
                {mode.kind === "create"
                  ? `Nova ${spec.singular}`
                  : `Editar ${spec.singular}`}
              </DialogTitle>
              <DialogDescription>
                Os campos marcados com * são obrigatórios.
              </DialogDescription>
            </DialogHeader>
            {spec.fields
              .filter(
                (field) => mode.kind === "create" || field.editable !== false,
              )
              .map((field) => {
                const id = `field-${field.name}`;
                const value = values[field.name] ?? "";
                const options: readonly Choice[] =
                  field.kind === "select"
                    ? (field.options ?? [])
                    : field.kind === "boolean"
                      ? [
                          ["true", "Sim"],
                          ["false", "Não"],
                        ]
                      : field.kind === "reference" && field.reference
                        ? (choices[field.name] ?? []).map(
                            (row) =>
                              [
                                row.id,
                                field.reference?.label(row) ?? row.id,
                              ] as const,
                          )
                        : [];
                return (
                  <div key={field.name} className="space-y-1">
                    <Label htmlFor={id}>
                      {field.label}
                      {field.required ? " *" : ""}
                    </Label>
                    {field.kind === "select" ||
                    field.kind === "reference" ||
                    field.kind === "boolean" ? (
                      <select
                        id={id}
                        className="block w-full rounded border bg-background p-2 text-sm"
                        value={value}
                        required={field.required}
                        onChange={(event) => change(field, event.target.value)}
                      >
                        <option value="">—</option>
                        {options.map(([option, label]) => (
                          <option key={option} value={option}>
                            {label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        id={id}
                        type={field.kind === "date" ? "date" : "text"}
                        inputMode={
                          field.kind === "amount" ? "decimal" : undefined
                        }
                        value={value}
                        required={field.required}
                        placeholder={field.placeholder}
                        onChange={(event) => change(field, event.target.value)}
                      />
                    )}
                    {field.description ? (
                      <p className="text-xs text-muted-foreground">
                        {field.description}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            {formError ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setMode({ kind: "closed" })}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={mode.kind === "delete"}
        onOpenChange={(isOpen) => !isOpen && setMode({ kind: "closed" })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir {spec.singular}</DialogTitle>
            <DialogDescription>
              O registro deixa de existir. Se outro registro ainda o usa, a
              exclusão é recusada.
            </DialogDescription>
          </DialogHeader>
          {formError ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMode({ kind: "closed" })}
            >
              Cancelar
            </Button>
            <Button variant="destructive" disabled={busy} onClick={remove}>
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
