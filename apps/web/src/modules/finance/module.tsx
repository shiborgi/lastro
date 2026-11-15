import { call } from "@/shell/client";
import type { WebModule, WebView } from "@/shell/registry";
import { ResourceScreen } from "@/shell/resource-screen";
/** Finance's screens, as one web module (ADR 11). */
import {
  financeOperations,
  listCardMovements,
  listPaymentMovements,
  listReceiptMovements,
  listRevenueMovements,
} from "@lastro/finance/contracts";
import type { OperationDescriptor } from "@lastro/kernel";
import { AccountMovementsScreen } from "./account-movements";
import { CardMovementsScreen } from "./card-movements";
import {
  ACCOUNTS,
  ACCOUNT_CYCLES,
  FINANCIAL_CATEGORIES,
  INSTITUTIONS,
  PARTIES,
} from "./catalogs";
import { ExpensesScreen } from "./expenses";
import { MovementFilesScreen } from "./movement-files";
import { ReceiptsScreen } from "./receipts";
import { RevenueMovementsScreen } from "./revenue-movements";
import { RevenuesScreen } from "./revenues";
import { TransfersScreen } from "./transfers";

const RECORDS = "Lançamentos";
const IMPORTS = "Importações";
const CATALOGS = "Cadastros";

const catalog = (id: string, spec: typeof ACCOUNTS): WebView => ({
  id,
  label: spec.title,
  group: CATALOGS,
  render: ({ bookId }) => (
    <ResourceScreen key={`${id}-${bookId}`} bookId={bookId} spec={spec} />
  ),
});

/** Lines waiting for review: the number beside an import entry. */
const pending = (list: OperationDescriptor) => async (bookId: string) =>
  (
    (await call(list, { status: "PENDING", limit: 100 }, { bookId })) as {
      items: unknown[];
    }
  ).items.length;

export const financeWebModule: WebModule = {
  id: "finance",
  label: "Financeiro",
  operations: financeOperations,
  views: [
    {
      id: "finance-expenses",
      label: "Despesas",
      group: RECORDS,
      render: ({ bookId }) => <ExpensesScreen key={bookId} bookId={bookId} />,
    },
    {
      id: "finance-revenues",
      label: "Receitas",
      group: RECORDS,
      render: ({ bookId }) => <RevenuesScreen key={bookId} bookId={bookId} />,
    },
    {
      id: "finance-receipts",
      label: "Recebimentos",
      group: RECORDS,
      render: ({ bookId }) => <ReceiptsScreen key={bookId} bookId={bookId} />,
    },
    {
      id: "finance-transfers",
      label: "Transferências",
      group: RECORDS,
      render: ({ bookId }) => <TransfersScreen key={bookId} bookId={bookId} />,
    },
    {
      id: "finance-account-movements",
      label: "Extratos",
      group: IMPORTS,
      render: ({ bookId, actions }) => (
        <AccountMovementsScreen
          key={bookId}
          bookId={bookId}
          actions={actions}
        />
      ),
      count: async (bookId) =>
        (await pending(listPaymentMovements)(bookId)) +
        (await pending(listReceiptMovements)(bookId)),
    },
    {
      id: "finance-card-movements",
      label: "Cartões",
      group: IMPORTS,
      render: ({ bookId, actions }) => (
        <CardMovementsScreen key={bookId} bookId={bookId} actions={actions} />
      ),
      count: pending(listCardMovements),
    },
    {
      id: "finance-revenue-movements",
      label: "Receitas importadas",
      group: IMPORTS,
      render: ({ bookId, actions }) => (
        <RevenueMovementsScreen
          key={bookId}
          bookId={bookId}
          actions={actions}
        />
      ),
      count: pending(listRevenueMovements),
    },
    {
      id: "finance-movement-files",
      label: "Arquivos",
      group: IMPORTS,
      render: ({ bookId }) => (
        <MovementFilesScreen key={bookId} bookId={bookId} />
      ),
    },
    catalog("finance-accounts", ACCOUNTS),
    catalog("finance-institutions", INSTITUTIONS),
    catalog("finance-parties", PARTIES),
    catalog("finance-financial-categories", FINANCIAL_CATEGORIES),
    catalog("finance-account-cycles", ACCOUNT_CYCLES),
  ],
};
