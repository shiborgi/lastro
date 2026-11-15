"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatStatementAmount, parseTypedAmount } from "@/lib/money";
import { call, newIdempotencyKey } from "@/shell/client";
import {
  ErrorNote,
  type Row,
  SelectField,
  TextField,
  failure,
  optionsOf,
  today,
  useList,
} from "@/shell/forms";
/** Expenses still open, recording a new one, and paying one now. */
import {
  accounts,
  createExpense,
  financialCategories,
  listOpenExpenses,
  parties,
  payExpense,
} from "@lastro/finance/contracts";
import { type FormEvent, useEffect, useState } from "react";

type Open = { expense: Row; outstanding: string; status: string };

const PAYMENT_METHODS = [
  ["PIX", "Pix"],
  ["BOLETO", "Boleto"],
  ["TRANSFER", "Transferência"],
  ["DEBIT_CARD", "Cartão de débito"],
  ["CREDIT_CARD", "Cartão de crédito"],
] as const;

export function ExpensesScreen({ bookId }: { bookId: string }) {
  const [version, setVersion] = useState(0);
  const [open, setOpen] = useState<{
    items: Open[];
    totals: { currency: string; outstanding: string }[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    { kind: "new" } | { kind: "pay"; item: Open } | null
  >(null);

  const refresh = () => setVersion((value) => value + 1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` reloads the list after a write
  useEffect(() => {
    let active = true;
    call(listOpenExpenses, {}, { bookId })
      .then((result) => {
        if (!active) return;
        setOpen(result as unknown as typeof open);
        setError(null);
      })
      .catch((cause) => active && setError(failure(cause)));
    return () => {
      active = false;
    };
  }, [bookId, version]);

  return (
    <section aria-label="Despesas" className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Despesas em aberto</h1>
        <Button onClick={() => setDialog({ kind: "new" })}>Nova despesa</Button>
      </header>
      <ErrorNote text={error} />
      {open && open.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nada a pagar.</p>
      ) : null}
      {open && open.items.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Despesa</TableHead>
              <TableHead>Competência</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="text-right">Em aberto</TableHead>
              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {open.items.map((item) => (
              <TableRow key={item.expense.id}>
                <TableCell>
                  {String(item.expense.name ?? item.expense.key)}
                </TableCell>
                <TableCell>
                  {String(item.expense.referenceMonth).slice(0, 7)}
                </TableCell>
                <TableCell className="tabular text-right">
                  {formatStatementAmount(String(item.expense.amount))}
                </TableCell>
                <TableCell className="tabular text-right">
                  {formatStatementAmount(item.outstanding)}
                </TableCell>
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDialog({ kind: "pay", item })}
                  >
                    Pagar
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      {open?.totals.map((total) => (
        <p key={total.currency} className="text-sm">
          Total em aberto:{" "}
          <span className="tabular">
            {formatStatementAmount(total.outstanding, total.currency)}
          </span>{" "}
          {total.currency}
        </p>
      ))}
      {dialog?.kind === "new" ? (
        <NewExpense
          bookId={bookId}
          onClose={() => setDialog(null)}
          onSaved={refresh}
        />
      ) : null}
      {dialog?.kind === "pay" ? (
        <PayExpense
          bookId={bookId}
          item={dialog.item}
          onClose={() => setDialog(null)}
          onSaved={refresh}
        />
      ) : null}
    </section>
  );
}

function NewExpense(props: {
  bookId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const partyList = useList(parties.list, props.bookId);
  const categoryList = useList(financialCategories.list, props.bookId, {
    kind: "EXPENSE",
  });
  const [key] = useState(newIdempotencyKey);
  const [form, setForm] = useState({
    name: "",
    partyId: "",
    financialCategoryId: "",
    amount: "",
    referenceMonth: today(),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (field: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  async function save(event: FormEvent) {
    event.preventDefault();
    const amount = parseTypedAmount(form.amount, "BRL");
    if (!amount || amount === "0")
      return setError("Valor: informe um valor positivo");
    setBusy(true);
    try {
      await call(
        createExpense,
        {
          key: `expense-${key}`,
          name: form.name || null,
          partyId: form.partyId,
          financialCategoryId: form.financialCategoryId,
          amount,
          currency: "BRL",
          referenceMonth: form.referenceMonth,
        },
        { bookId: props.bookId, idempotencyKey: key },
      );
      props.onSaved();
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
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nova despesa</DialogTitle>
            <DialogDescription>
              O que o Book deve. Pagar é outro passo.
            </DialogDescription>
          </DialogHeader>
          <TextField
            id="expense-name"
            label="Descrição"
            value={form.name}
            onChange={set("name")}
          />
          <SelectField
            id="expense-party"
            label="Parte"
            required
            value={form.partyId}
            onChange={set("partyId")}
            options={optionsOf(partyList.items)}
          />
          <SelectField
            id="expense-category"
            label="Categoria financeira"
            required
            value={form.financialCategoryId}
            onChange={set("financialCategoryId")}
            options={optionsOf(
              categoryList.items?.filter((each) => each.role !== "DEDUCTION") ??
                null,
            )}
          />
          <TextField
            id="expense-amount"
            label="Valor"
            required
            inputMode="decimal"
            value={form.amount}
            onChange={set("amount")}
          />
          <TextField
            id="expense-month"
            label="Competência"
            type="date"
            required
            value={form.referenceMonth}
            onChange={set("referenceMonth")}
          />
          <ErrorNote text={error ?? partyList.error ?? categoryList.error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PayExpense(props: {
  bookId: string;
  item: Open;
  onClose: () => void;
  onSaved: () => void;
}) {
  const accountList = useList(accounts.list, props.bookId);
  const categoryList = useList(financialCategories.list, props.bookId, {
    kind: "EXPENSE",
  });
  const [key] = useState(newIdempotencyKey);
  const [form, setForm] = useState({
    accountId: "",
    amount: formatStatementAmount(props.item.outstanding).replace(/\./g, ""),
    paidOn: today(),
    method: "",
    discount: "",
    discountCategoryId: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (field: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  async function save(event: FormEvent) {
    event.preventDefault();
    const amount = parseTypedAmount(form.amount, "BRL");
    if (!amount || amount === "0")
      return setError("Valor: informe um valor positivo");
    const discount = form.discount
      ? parseTypedAmount(form.discount, "BRL")
      : null;
    if (form.discount && !discount) return setError("Desconto: valor inválido");
    setBusy(true);
    try {
      await call(
        payExpense,
        {
          expenseId: props.item.expense.id,
          accountId: form.accountId,
          amount,
          paidOn: form.paidOn,
          ...(form.method
            ? { method: form.method as (typeof PAYMENT_METHODS)[number][0] }
            : {}),
          ...(discount
            ? {
                discount: {
                  amount: discount,
                  financialCategoryId: form.discountCategoryId,
                },
              }
            : {}),
        },
        { bookId: props.bookId, idempotencyKey: key },
      );
      props.onSaved();
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
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              Pagar {String(props.item.expense.name ?? props.item.expense.key)}
            </DialogTitle>
            <DialogDescription>
              Em aberto:{" "}
              <span className="tabular">
                {formatStatementAmount(props.item.outstanding)}
              </span>
            </DialogDescription>
          </DialogHeader>
          <SelectField
            id="pay-account"
            label="Conta"
            required
            value={form.accountId}
            onChange={set("accountId")}
            options={optionsOf(accountList.items)}
          />
          <TextField
            id="pay-amount"
            label="Valor da parcela"
            required
            inputMode="decimal"
            value={form.amount}
            onChange={set("amount")}
          />
          <TextField
            id="pay-date"
            label="Pago em"
            type="date"
            required
            value={form.paidOn}
            onChange={set("paidOn")}
          />
          <SelectField
            id="pay-method"
            label="Meio"
            value={form.method}
            onChange={set("method")}
            options={PAYMENT_METHODS}
          />
          <TextField
            id="pay-discount"
            label="Desconto obtido"
            inputMode="decimal"
            value={form.discount}
            onChange={set("discount")}
          />
          {form.discount ? (
            <SelectField
              id="pay-discount-category"
              label="Categoria do desconto"
              required
              value={form.discountCategoryId}
              onChange={set("discountCategoryId")}
              options={optionsOf(
                categoryList.items?.filter(
                  (each) => each.role === "DEDUCTION",
                ) ?? null,
              )}
            />
          ) : null}
          <ErrorNote text={error ?? accountList.error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              Pagar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
