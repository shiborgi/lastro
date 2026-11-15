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
 * Imported sales (docs/flows/yooga-sales.md): one movement per product and
 * day as the point of sale printed it. A movement posts as a sale line once
 * its code's descriptor names a product; the rest wait here.
 */
import {
  classifySaleMovementDescriptor,
  ignoreSaleMovement,
  listSaleMovements,
  postSaleMovement,
  products,
  undoSaleMovement,
} from "@lastro/sales/contracts";
import { useState } from "react";

const money = (value: unknown) =>
  value === null || value === undefined
    ? "—"
    : formatStatementAmount(String(value));

export function SaleMovementsScreen({
  bookId,
  actions,
}: {
  bookId: string;
  actions: readonly ViewAction[];
}) {
  const productList = useList(products.list, bookId);
  return (
    <EvidenceScreen
      bookId={bookId}
      title="Vendas importadas"
      emptyText="Nenhuma venda."
      list={listSaleMovements}
      columns={[
        { header: "Dia", cell: (row) => String(row.businessDate) },
        { header: "Código", cell: (row) => String(row.code ?? "—") },
        { header: "Produto", cell: (row) => String(row.name) },
        { header: "Qtde", numeric: true, cell: (row) => String(row.quantity) },
        {
          header: "Faturamento",
          numeric: true,
          cell: (row) => money(row.revenue),
        },
        { header: "Custo", numeric: true, cell: (row) => money(row.cost) },
      ]}
      post={postSaleMovement}
      ignore={{
        operation: ignoreSaleMovement,
        description: "A venda não vira linha do dia. O motivo fica registrado.",
      }}
      undo={{
        operation: undoSaleMovement,
        description:
          "A venda volta a pendente; a linha do dia que ela criou é removida.",
      }}
      actions={actions}
      renderClassify={(movement, context) => (
        <ClassifyDialog
          bookId={bookId}
          movement={movement}
          products={productList.items}
          {...context}
        />
      )}
    />
  );
}

/* One product per code; it applies to every day the code appears. */
function ClassifyDialog(props: {
  bookId: string;
  movement: Row;
  products: Row[] | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [productId, setProductId] = useState("");
  return (
    <FormDialog
      title="Classificar"
      description={
        <>
          Vale para todo dia do código “
          {String(props.movement.code ?? props.movement.name)}” (
          {String(props.movement.name)}). As vendas pendentes dele são lançadas
          agora.
        </>
      }
      submit="Classificar e lançar"
      onClose={props.onClose}
      onSubmit={async (key) => {
        await call(
          classifySaleMovementDescriptor,
          {
            descriptorKey: String(props.movement.descriptorKey),
            productId,
          },
          { bookId: props.bookId, idempotencyKey: key },
        );
        props.onDone();
        props.onClose();
      }}
    >
      <SelectField
        id="sale-product"
        label="Produto"
        required
        value={productId}
        onChange={setProductId}
        options={optionsOf(props.products)}
      />
    </FormDialog>
  );
}
