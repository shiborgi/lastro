"use client";

import { useList } from "@/shell/forms";
import { ListScreen } from "@/shell/list-screen";
/** Every file taken into an account, by any import flow, newest first. */
import { accounts, listMovementFiles } from "@lastro/finance/contracts";

const TYPE_LABEL: Record<string, string> = {
  "account-movements": "Extrato da conta",
  "receipt-movements": "Repasses esperados",
  "card-movements": "Fatura do cartão",
  "revenue-movements": "Receitas",
};

export function MovementFilesScreen({ bookId }: { bookId: string }) {
  const accountList = useList(accounts.list, bookId);
  const accountName = (id: unknown) =>
    String(accountList.items?.find((each) => each.id === id)?.name ?? id);
  return (
    <ListScreen
      bookId={bookId}
      title="Arquivos"
      description="O mesmo arquivo enviado de novo não aparece duas vezes."
      list={listMovementFiles}
      emptyText="Nenhum arquivo."
      columns={[
        {
          header: "Importado em",
          cell: (row) => String(row.importedAt).slice(0, 16).replace("T", " "),
        },
        { header: "Conta", cell: (row) => accountName(row.accountId) },
        {
          header: "Tipo",
          cell: (row) =>
            TYPE_LABEL[String(row.movementType)] ?? String(row.movementType),
        },
        { header: "Origem", cell: (row) => String(row.sourceKey) },
        {
          header: "Leitor",
          cell: (row) => `${row.importerId} v${row.importerVersion}`,
        },
        {
          header: "Linhas",
          numeric: true,
          cell: (row) => String(row.lineCount),
        },
        { header: "Novas", numeric: true, cell: (row) => String(row.newCount) },
      ]}
    />
  );
}
