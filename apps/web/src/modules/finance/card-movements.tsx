"use client";

import { formatStatementAmount } from "@/lib/money";
import { call } from "@/shell/client";
import { EvidenceScreen } from "@/shell/evidence-screen";
import {
  FormDialog,
  type Row,
  SelectField,
  optionsOf,
  useList,
} from "@/shell/forms";
import type { ViewAction } from "@/shell/registry";
/**
 * Card invoices (docs/flows/c6-card.md): the lines taken into a card. A
 * purchase whose merchant name is classified, and whose date a billing window
 * holds, posts on its own as one expense with one invoice payment per
 * instalment; the rest wait here. The descriptor decides.
 */
import {
  accounts,
  classifyCardMovementDescriptor,
  financialCategories,
  ignoreCardMovement,
  listCardMovements,
  parties,
  postCardMovement,
  undoCardMovement,
} from "@lastro/finance/contracts";
import { useState } from "react";

export function CardMovementsScreen({
  bookId,
  actions,
}: {
  bookId: string;
  actions: readonly ViewAction[];
}) {
  const accountList = useList(accounts.list, bookId);
  const partyList = useList(parties.list, bookId);
  const categoryList = useList(financialCategories.list, bookId);
  const nameIn = (rows: Row[] | null, id: unknown) =>
    id ? String(rows?.find((each) => each.id === id)?.name ?? id) : "";

  return (
    <EvidenceScreen
      bookId={bookId}
      title="Cartões"
      list={listCardMovements}
      columns={[
        { header: "Compra", cell: (row) => String(row.occurredOn) },
        {
          header: "Cartão",
          cell: (row) =>
            `${nameIn(accountList.items, row.accountId)} ${row.cardLast4 ?? ""}`,
        },
        {
          header: "Estabelecimento",
          cell: (row) => (
            <span title={String(row.description)}>{String(row.name)}</span>
          ),
        },
        {
          header: "Parcela",
          cell: (row) => `${row.installmentNumber}/${row.installmentCount}`,
        },
        {
          header: "Classificação",
          cell: (row) =>
            [
              nameIn(partyList.items, row.partyId),
              nameIn(categoryList.items, row.financialCategoryId),
            ]
              .filter(Boolean)
              .join(" · "),
        },
        {
          header: "Valor",
          numeric: true,
          cell: (row) => formatStatementAmount(String(row.amount)),
        },
      ]}
      post={postCardMovement}
      ignore={{
        operation: ignoreCardMovement,
        description: "A linha não vira lançamento. O motivo fica registrado.",
      }}
      undo={{
        operation: undoCardMovement,
        description:
          "A linha volta a pendente. Quando nenhuma outra parcela da compra continua lançada, as parcelas agendadas são anuladas.",
      }}
      actions={actions}
      renderClassify={(line, context) => (
        <ClassifyDialog
          bookId={bookId}
          line={line}
          accounts={
            accountList.items?.filter((each) => each.id !== line.accountId) ??
            null
          }
          parties={partyList.items}
          categories={
            categoryList.items?.filter((each) => each.kind === "EXPENSE") ??
            null
          }
          {...context}
        />
      )}
    />
  );
}

const METHODS: [string, string][] = [
  ["", "Sem método"],
  ["PIX", "Pix"],
  ["BOLETO", "Boleto"],
  ["TRANSFER", "Transferência"],
  ["DEBIT_CARD", "Cartão de débito"],
  ["CREDIT_CARD", "Cartão de crédito"],
];

function ClassifyDialog(props: {
  bookId: string;
  line: Row;
  accounts: Row[] | null;
  parties: Row[] | null;
  categories: Row[] | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [partyId, setPartyId] = useState("");
  const [financialCategoryId, setCategoryId] = useState("");
  const [counterAccountId, setCounterAccountId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState(
    String(props.line.paymentMethod ?? ""),
  );
  const transfer = counterAccountId !== "";
  return (
    <FormDialog
      title="Classificar"
      description={
        <>
          Vale para toda linha de “{String(props.line.name)}” neste cartão. Uma
          compra pede parte e categoria; um estorno, uma categoria de dedução; a
          fatura paga, a conta de onde saiu. As pendentes elegíveis são lançadas
          agora e as próximas, ao importar.
        </>
      }
      submit="Classificar e lançar"
      onClose={props.onClose}
      onSubmit={async (key) => {
        await call(
          classifyCardMovementDescriptor,
          {
            accountId: String(props.line.accountId),
            descriptorKey: String(props.line.descriptorKey),
            ...(transfer
              ? { counterAccountId }
              : { partyId, financialCategoryId }),
            paymentMethod: (paymentMethod || null) as
              | "PIX"
              | "BOLETO"
              | "TRANSFER"
              | "DEBIT_CARD"
              | "CREDIT_CARD"
              | null,
          },
          { bookId: props.bookId, idempotencyKey: key },
        );
        props.onDone();
        props.onClose();
      }}
    >
      <SelectField
        id="card-classify-transfer"
        label="Fatura paga pela conta"
        value={counterAccountId}
        onChange={setCounterAccountId}
        options={[
          ["", "Não é pagamento de fatura"],
          ...optionsOf(props.accounts),
        ]}
      />
      <SelectField
        id="card-classify-method"
        label="Método de pagamento"
        value={paymentMethod}
        onChange={setPaymentMethod}
        options={METHODS}
      />
      {transfer ? null : (
        <>
          <SelectField
            id="card-classify-party"
            label="Parte"
            required
            value={partyId}
            onChange={setPartyId}
            options={optionsOf(props.parties)}
          />
          <SelectField
            id="card-classify-category"
            label="Categoria financeira (despesa ou dedução)"
            required
            value={financialCategoryId}
            onChange={setCategoryId}
            options={optionsOf(props.categories)}
          />
        </>
      )}
    </FormDialog>
  );
}
