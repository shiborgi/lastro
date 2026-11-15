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
  SelectField,
  TextField,
  amountOf,
  optionsOf,
  today,
  useList,
} from "@/shell/forms";
/** Transfers between the Book's own accounts. */
import {
  accounts,
  createTransfer,
  listTransfers,
} from "@lastro/finance/contracts";
import { useState } from "react";

export function TransfersScreen({ bookId }: { bookId: string }) {
  const [version, setVersion] = useState(0);
  const list = useList(listTransfers, bookId, { limit: 100 }, version);
  const accountList = useList(accounts.list, bookId);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    sourceAccountId: "",
    destinationAccountId: "",
    amount: "",
    occurredOn: today(),
    name: "",
  });
  const set = (field: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [field]: value }));
  const nameOf = (id: unknown) =>
    accountList.items?.find((each) => each.id === id)?.name ?? String(id);

  return (
    <section aria-label="Transferências" className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Transferências</h1>
        <Button onClick={() => setCreating(true)}>Nova transferência</Button>
      </header>
      <ErrorNote text={list.error} />
      {list.items && list.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma transferência.</p>
      ) : null}
      {list.items && list.items.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>De</TableHead>
              <TableHead>Para</TableHead>
              <TableHead className="text-right">Valor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((transfer) => (
              <TableRow key={transfer.id}>
                <TableCell>
                  {String(transfer.occurredOn ?? transfer.referenceMonth)}
                </TableCell>
                <TableCell>
                  {String(nameOf(transfer.sourceAccountId))}
                </TableCell>
                <TableCell>
                  {String(nameOf(transfer.destinationAccountId))}
                </TableCell>
                <TableCell className="tabular text-right">
                  {formatStatementAmount(String(transfer.amount))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      {creating ? (
        <FormDialog
          title="Nova transferência"
          description="Dinheiro entre duas contas do Book: não é despesa nem receita."
          submit="Salvar"
          onClose={() => setCreating(false)}
          onSubmit={async (key) => {
            await call(
              createTransfer,
              {
                key: `transfer-${key}`,
                sourceAccountId: form.sourceAccountId,
                destinationAccountId: form.destinationAccountId,
                name: form.name || null,
                amount: amountOf("Valor", form.amount),
                currency: "BRL",
                referenceMonth: form.occurredOn,
                occurredOn: form.occurredOn,
              },
              { bookId, idempotencyKey: key },
            );
            setVersion((value) => value + 1);
          }}
        >
          <SelectField
            id="transfer-from"
            label="De"
            required
            value={form.sourceAccountId}
            onChange={set("sourceAccountId")}
            options={optionsOf(accountList.items)}
          />
          <SelectField
            id="transfer-to"
            label="Para"
            required
            value={form.destinationAccountId}
            onChange={set("destinationAccountId")}
            options={optionsOf(accountList.items)}
          />
          <TextField
            id="transfer-amount"
            label="Valor"
            required
            inputMode="decimal"
            value={form.amount}
            onChange={set("amount")}
          />
          <TextField
            id="transfer-date"
            label="Data"
            type="date"
            required
            value={form.occurredOn}
            onChange={set("occurredOn")}
          />
          <TextField
            id="transfer-name"
            label="Descrição"
            value={form.name}
            onChange={set("name")}
          />
        </FormDialog>
      ) : null}
    </section>
  );
}
