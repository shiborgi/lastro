"use client";

import { formatStatementAmount } from "@/lib/money";
import { call } from "@/shell/client";
import { EvidenceScreen } from "@/shell/evidence-screen";
import {
  FormDialog,
  type Row,
  SelectField,
  TextField,
  optionsOf,
  useList,
} from "@/shell/forms";
import type { ViewAction } from "@/shell/registry";
/**
 * Account movements (docs/flows/nubank-account.md): the lines taken into an
 * account, one side at a time: payment movements (money out) and receipt
 * movements (money in). A line whose name is classified, or that names
 * another account of the Book, and whose payment method is known, posts on
 * its own; the rest wait here.
 */
import {
  accounts,
  classifyPaymentMovementDescriptor,
  classifyReceiptMovementDescriptor,
  financialCategories,
  ignorePaymentMovement,
  ignoreReceiptMovement,
  listPaymentMovements,
  listReceiptMovements,
  parties,
  undoPaymentMovement,
  undoReceiptMovement,
} from "@lastro/finance/contracts";
import { useState } from "react";

const NONE = "";

const METHODS: [string, string][] = [
  ["PIX", "Pix"],
  ["BOLETO", "Boleto"],
  ["TRANSFER", "Transferência"],
  ["DEBIT_CARD", "Cartão de débito"],
  ["CREDIT_CARD", "Cartão de crédito"],
];
const methodLabel = (value: unknown) =>
  METHODS.find(([key]) => key === value)?.[1] ?? "sem método";

type Side = "PAYMENT" | "RECEIPT";

const SIDES = {
  PAYMENT: {
    list: listPaymentMovements,
    ignore: ignorePaymentMovement,
    undo: undoPaymentMovement,
    classify: classifyPaymentMovementDescriptor,
    kind: "EXPENSE",
  },
  RECEIPT: {
    list: listReceiptMovements,
    ignore: ignoreReceiptMovement,
    undo: undoReceiptMovement,
    classify: classifyReceiptMovementDescriptor,
    kind: "REVENUE",
  },
} as const;

export function AccountMovementsScreen({
  bookId,
  actions,
}: {
  bookId: string;
  actions: readonly ViewAction[];
}) {
  const [side, setSide] = useState<Side>("PAYMENT");
  const ops = SIDES[side];
  const accountList = useList(accounts.list, bookId);
  const partyList = useList(parties.list, bookId);
  const categoryList = useList(financialCategories.list, bookId);

  const nameIn = (rows: Row[] | null, id: unknown) =>
    id ? String(rows?.find((each) => each.id === id)?.name ?? id) : "";
  const outcome = (movement: Row) =>
    movement.counterAccountId
      ? `Transferência · ${nameIn(accountList.items, movement.counterAccountId)} · ${methodLabel(movement.paymentMethod)}`
      : [
          nameIn(partyList.items, movement.partyId),
          movement.settlementGroup
            ? `liquida vendas · ${String(movement.settlementGroup)}`
            : nameIn(categoryList.items, movement.financialCategoryId),
          methodLabel(movement.paymentMethod),
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <EvidenceScreen
      key={side}
      bookId={bookId}
      title="Extratos"
      list={ops.list}
      filters={
        <>
          <label className="sr-only" htmlFor="movement-side">
            Lado
          </label>
          <select
            id="movement-side"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={side}
            onChange={(event) => setSide(event.target.value as Side)}
          >
            <option value="PAYMENT">Saídas</option>
            <option value="RECEIPT">Entradas</option>
          </select>
        </>
      }
      columns={[
        { header: "Data", cell: (row) => String(row.occurredOn) },
        {
          header: "Conta",
          cell: (row) => nameIn(accountList.items, row.accountId),
        },
        {
          header: "Descrição",
          cell: (row) => (
            <span title={String(row.description)}>
              {String(row.description)}
            </span>
          ),
        },
        { header: "Classificação", cell: outcome },
        {
          header: "Valor",
          numeric: true,
          cell: (row) =>
            formatStatementAmount(
              `${side === "PAYMENT" ? "-" : ""}${row.amount}`,
            ),
        },
      ]}
      ignore={{
        operation: ops.ignore,
        description: "A linha não vira lançamento. O motivo fica registrado.",
      }}
      undo={{
        operation: ops.undo,
        description:
          "A linha volta a pendente. Um lançamento é desfeito anulando a quitação que fez ou removendo a transferência que criou.",
      }}
      actions={actions}
      renderClassify={(movement, context) => (
        <ClassifyDialog
          bookId={bookId}
          side={side}
          movement={movement}
          accounts={accountList.items}
          parties={partyList.items}
          categories={
            categoryList.items?.filter(
              (each) => each.kind === ops.kind && each.role !== "DEDUCTION",
            ) ?? null
          }
          {...context}
        />
      )}
    />
  );
}

function ClassifyDialog(props: {
  bookId: string;
  side: Side;
  movement: Row;
  accounts: Row[] | null;
  parties: Row[] | null;
  categories: Row[] | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [counterAccountId, setCounterAccountId] = useState(NONE);
  const [partyId, setPartyId] = useState(NONE);
  const [financialCategoryId, setCategoryId] = useState(NONE);
  const [settlementGroup, setSettlementGroup] = useState("");
  const [paymentMethod, setPaymentMethod] = useState(
    String(props.movement.paymentMethod ?? NONE),
  );
  const transfer = counterAccountId !== NONE;
  const receipt = props.side === "RECEIPT";
  const settles = receipt && settlementGroup.trim() !== "";
  return (
    <FormDialog
      title="Classificar"
      description={
        <>
          Vale para toda linha de “{String(props.movement.name)}” nesta conta:
          as pendentes com método conhecido são lançadas agora e as próximas, ao
          importar.
        </>
      }
      submit="Classificar e lançar"
      onClose={props.onClose}
      onSubmit={async (key) => {
        const ref = {
          accountId: String(props.movement.accountId),
          descriptorKey: String(props.movement.descriptorKey),
          paymentMethod: (paymentMethod || null) as
            | "PIX"
            | "BOLETO"
            | "TRANSFER"
            | "DEBIT_CARD"
            | "CREDIT_CARD"
            | null,
        };
        const input = transfer
          ? { ...ref, counterAccountId }
          : settles
            ? {
                ...ref,
                partyId: partyId || null,
                settlementGroup: settlementGroup.trim(),
              }
            : {
                ...ref,
                partyId: partyId || null,
                financialCategoryId: financialCategoryId || null,
              };
        const options = { bookId: props.bookId, idempotencyKey: key };
        if (receipt)
          await call(classifyReceiptMovementDescriptor, input, options);
        else await call(classifyPaymentMovementDescriptor, input, options);
        props.onDone();
        props.onClose();
      }}
    >
      <SelectField
        id="classify-transfer"
        label="Transferência com a conta"
        value={counterAccountId}
        onChange={setCounterAccountId}
        options={[
          [NONE, "Não é transferência"],
          ...optionsOf(
            props.accounts?.filter(
              (each) => each.id !== props.movement.accountId,
            ) ?? null,
          ),
        ]}
      />
      <SelectField
        id="classify-method"
        label="Método de pagamento"
        required
        value={paymentMethod}
        onChange={setPaymentMethod}
        options={METHODS}
      />
      {transfer ? null : (
        <>
          <SelectField
            id="classify-party"
            label="Parte"
            required
            value={partyId}
            onChange={setPartyId}
            options={optionsOf(props.parties)}
          />
          {receipt ? (
            <TextField
              id="classify-settlement-group"
              label="Liquida vendas do grupo (sem categoria: não cria receita)"
              value={settlementGroup}
              onChange={setSettlementGroup}
            />
          ) : null}
          {settles ? null : (
            <SelectField
              id="classify-category"
              label={
                props.side === "PAYMENT"
                  ? "Categoria financeira (despesa)"
                  : "Categoria financeira (receita)"
              }
              required
              value={financialCategoryId}
              onChange={setCategoryId}
              options={optionsOf(props.categories)}
            />
          )}
        </>
      )}
    </FormDialog>
  );
}
