"use client";

import { formatStatementAmount } from "@/lib/money";
import { useList } from "@/shell/forms";
import { ListScreen } from "@/shell/list-screen";
/**
 * Receipts: what arrived, or is expected to arrive, in an account. A receipt
 * with no paid date is a promise, such as an acquirer's scheduled deposit;
 * the bank line that matches it makes it received.
 */
import { accounts, listReceipts } from "@lastro/finance/contracts";

export function ReceiptsScreen({ bookId }: { bookId: string }) {
  const accountList = useList(accounts.list, bookId);
  const accountName = (id: unknown) =>
    String(accountList.items?.find((each) => each.id === id)?.name ?? id);
  return (
    <ListScreen
      bookId={bookId}
      title="Recebimentos"
      list={listReceipts}
      emptyText="Nenhum recebimento."
      columns={[
        {
          header: "Data",
          cell: (row) => String(row.paidOn ?? row.dueOn ?? row.referenceMonth),
        },
        { header: "Conta", cell: (row) => accountName(row.accountId) },
        { header: "Chave", cell: (row) => String(row.key ?? "—") },
        {
          header: "Situação",
          cell: (row) => (row.paidOn ? "Recebido" : "Esperado"),
        },
        {
          header: "Valor",
          numeric: true,
          cell: (row) => formatStatementAmount(String(row.amount)),
        },
      ]}
    />
  );
}
