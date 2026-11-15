"use client";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatStatementAmount } from "@/lib/money";
import { call } from "@/shell/client";
import {
  ErrorNote,
  FormDialog,
  type Row,
  SelectField,
  TextField,
  amountOf,
  optionsOf,
  today,
  useList,
} from "@/shell/forms";
/** Revenues, recording one entered on its own, and receiving it now. */
import {
  accounts,
  createRevenue,
  financialCategories,
  listRevenues,
  parties,
  receiveRevenue,
} from "@lastro/finance/contracts";
import { useState } from "react";

export function RevenuesScreen({ bookId }: { bookId: string }) {
  const [version, setVersion] = useState(0);
  const list = useList(listRevenues, bookId, { limit: 100 }, version);
  const [dialog, setDialog] = useState<
    { kind: "new" } | { kind: "receive"; revenue: Row } | null
  >(null);
  const refresh = () => setVersion((value) => value + 1);

  return (
    <section aria-label="Receitas" className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Receitas</h1>
        <Button onClick={() => setDialog({ kind: "new" })}>Nova receita</Button>
      </header>
      <ErrorNote text={list.error} />
      {list.items && list.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma receita.</p>
      ) : null}
      {list.items && list.items.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Receita</TableHead>
              <TableHead>Competência</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((revenue) => (
              <TableRow key={revenue.id}>
                <TableCell>{String(revenue.name ?? revenue.key)}</TableCell>
                <TableCell>
                  {String(revenue.referenceMonth).slice(0, 7)}
                </TableCell>
                <TableCell className="tabular text-right">
                  {formatStatementAmount(String(revenue.amount))}
                </TableCell>
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDialog({ kind: "receive", revenue })}
                  >
                    Receber
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      {dialog?.kind === "new" ? (
        <NewRevenue
          bookId={bookId}
          onClose={() => setDialog(null)}
          onSaved={refresh}
        />
      ) : null}
      {dialog?.kind === "receive" ? (
        <Receive
          bookId={bookId}
          revenue={dialog.revenue}
          onClose={() => setDialog(null)}
          onSaved={refresh}
        />
      ) : null}
    </section>
  );
}

function NewRevenue(props: {
  bookId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const partyList = useList(parties.list, props.bookId);
  const categoryList = useList(financialCategories.list, props.bookId, {
    kind: "REVENUE",
  });
  const [form, setForm] = useState({
    name: "",
    partyId: "",
    financialCategoryId: "",
    amount: "",
    referenceMonth: today(),
  });
  const set = (field: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [field]: value }));
  return (
    <FormDialog
      title="Nova receita"
      description="O que o Book ganhou. Receber o dinheiro é outro passo."
      submit="Salvar"
      onClose={props.onClose}
      onSubmit={async (key) => {
        await call(
          createRevenue,
          {
            key: `revenue-${key}`,
            name: form.name || null,
            partyId: form.partyId,
            financialCategoryId: form.financialCategoryId,
            amount: amountOf("Valor", form.amount),
            currency: "BRL",
            referenceMonth: form.referenceMonth,
          },
          { bookId: props.bookId, idempotencyKey: key },
        );
        props.onSaved();
      }}
    >
      <TextField
        id="revenue-name"
        label="Descrição"
        value={form.name}
        onChange={set("name")}
      />
      <SelectField
        id="revenue-party"
        label="Parte"
        required
        value={form.partyId}
        onChange={set("partyId")}
        options={optionsOf(partyList.items)}
      />
      <SelectField
        id="revenue-category"
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
        id="revenue-amount"
        label="Valor"
        required
        inputMode="decimal"
        value={form.amount}
        onChange={set("amount")}
      />
      <TextField
        id="revenue-month"
        label="Competência"
        type="date"
        required
        value={form.referenceMonth}
        onChange={set("referenceMonth")}
      />
    </FormDialog>
  );
}

function Receive(props: {
  bookId: string;
  revenue: Row;
  onClose: () => void;
  onSaved: () => void;
}) {
  const accountList = useList(accounts.list, props.bookId);
  const [form, setForm] = useState({
    accountId: "",
    amount: formatStatementAmount(String(props.revenue.amount)).replace(
      /\./g,
      "",
    ),
    paidOn: today(),
  });
  const set = (field: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [field]: value }));
  return (
    <FormDialog
      title={`Receber ${String(props.revenue.name ?? props.revenue.key)}`}
      submit="Receber"
      onClose={props.onClose}
      onSubmit={async (key) => {
        await call(
          receiveRevenue,
          {
            revenueId: props.revenue.id,
            accountId: form.accountId,
            amount: amountOf("Valor", form.amount),
            paidOn: form.paidOn,
          },
          { bookId: props.bookId, idempotencyKey: key },
        );
        props.onSaved();
      }}
    >
      <SelectField
        id="receive-account"
        label="Conta"
        required
        value={form.accountId}
        onChange={set("accountId")}
        options={optionsOf(accountList.items)}
      />
      <TextField
        id="receive-amount"
        label="Valor"
        required
        inputMode="decimal"
        value={form.amount}
        onChange={set("amount")}
      />
      <TextField
        id="receive-date"
        label="Recebido em"
        type="date"
        required
        value={form.paidOn}
        onChange={set("paidOn")}
      />
    </FormDialog>
  );
}
