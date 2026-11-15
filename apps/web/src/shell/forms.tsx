"use client";

/** The form pieces every module screen shares: lists, fields, a dialog holding one write. */

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
import { parseTypedAmount } from "@/lib/money";
import type { OperationDescriptor } from "@lastro/kernel";
import { useEffect, useState } from "react";
import { call, newIdempotencyKey } from "./client";

export type Row = { id: string } & Record<string, unknown>;

export const failure = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Não foi possível concluir";

/** The items of a list operation, reloaded when `version` changes. */
export function useList(
  descriptor: OperationDescriptor,
  bookId: string,
  input: Record<string, unknown> = {},
  version = 0,
) {
  const [items, setItems] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const serialized = JSON.stringify(input);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the input is compared by value
  useEffect(() => {
    let active = true;
    call(descriptor, JSON.parse(serialized), { bookId })
      .then((result) => {
        if (!active) return;
        setItems((result as { items: Row[] }).items);
        setError(null);
      })
      .catch((cause) => active && setError(failure(cause)));
    return () => {
      active = false;
    };
  }, [descriptor, bookId, serialized, version]);
  return { items, error };
}

export function ErrorNote({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  );
}

export function TextField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "date";
  required?: boolean;
  inputMode?: "decimal";
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={props.id}>
        {props.label}
        {props.required ? " *" : ""}
      </Label>
      <Input
        id={props.id}
        type={props.type ?? "text"}
        inputMode={props.inputMode}
        value={props.value}
        required={props.required}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </div>
  );
}

export function SelectField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
  required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={props.id}>
        {props.label}
        {props.required ? " *" : ""}
      </Label>
      <select
        id={props.id}
        className="block w-full rounded border bg-background p-2 text-sm"
        value={props.value}
        required={props.required}
        onChange={(event) => props.onChange(event.target.value)}
      >
        <option value="">—</option>
        {props.options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

export const optionsOf = (rows: Row[] | null) =>
  (rows ?? []).map(
    (row) => [row.id, String(row.name ?? row.key ?? row.id)] as const,
  );

/** Today as `YYYY-MM-DD` in the operator's time zone. */
export function today(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * A dialog holding one write: its fields, the error the API answered with,
 * and one idempotency key kept across the operator's retries.
 */
export function FormDialog(props: {
  title: string;
  description?: React.ReactNode;
  submit: string;
  destructive?: boolean;
  onClose: () => void;
  onSubmit: (idempotencyKey: string) => Promise<void>;
  children?: React.ReactNode;
}) {
  const [key] = useState(newIdempotencyKey);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await props.onSubmit(key);
      props.onClose();
    } catch (cause) {
      setError(failure(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && props.onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{props.title}</DialogTitle>
            {props.description ? (
              <DialogDescription>{props.description}</DialogDescription>
            ) : null}
          </DialogHeader>
          {props.children}
          <ErrorNote text={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>
              Cancelar
            </Button>
            <Button
              type="submit"
              variant={props.destructive ? "destructive" : "default"}
              disabled={busy}
            >
              {props.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Minor units from what the operator typed, or an error naming the field. */
export function amountOf(label: string, typed: string): string {
  const amount = parseTypedAmount(typed, "BRL");
  if (!amount || amount === "0")
    throw new Error(`${label}: informe um valor positivo`);
  return amount;
}
