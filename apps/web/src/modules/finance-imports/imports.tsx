"use client";

import { call } from "@/shell/client";
import { ImportFileDialog } from "@/shell/evidence-screen";
import { type Row, SelectField, optionsOf, useList } from "@/shell/forms";
import type { ActionContext } from "@/shell/registry";
import { importMovements } from "@lastro/finance-imports/contracts";
/**
 * Uploading a file to an account (ADR 14). The account and the type pick the
 * reader through the account's consumer; sending a file again never stages a
 * line twice. Each dialog is an action on the finance view it fills.
 */
import { accounts } from "@lastro/finance/contracts";
import { useState } from "react";

function ImportDialog(props: {
  context: ActionContext;
  title: string;
  description: string;
  fileLabel: string;
  accountLabel: string;
  accountFilter: (account: Row) => boolean;
  types: readonly (readonly [string, string])[];
}) {
  const accountList = useList(accounts.list, props.context.bookId);
  const [accountId, setAccountId] = useState("");
  const [type, setType] = useState(props.types[0]?.[0] ?? "");
  return (
    <ImportFileDialog
      title={props.title}
      description={props.description}
      fileLabel={props.fileLabel}
      context={props.context}
      send={(file, key) =>
        call(
          importMovements,
          { accountId, type, key: file.name, content: file.content },
          { bookId: props.context.bookId, idempotencyKey: key },
        )
      }
    >
      <SelectField
        id="import-account"
        label={props.accountLabel}
        required
        value={accountId}
        onChange={setAccountId}
        options={optionsOf(
          accountList.items?.filter(props.accountFilter) ?? null,
        )}
      />
      {props.types.length > 1 ? (
        <SelectField
          id="import-type"
          label="Tipo"
          required
          value={type}
          onChange={setType}
          options={props.types}
        />
      ) : null}
    </ImportFileDialog>
  );
}

export const importStatement = (context: ActionContext) => (
  <ImportDialog
    context={context}
    title="Importar extrato"
    description="O leitor é o definido para a conta e o tipo. Enviar o mesmo arquivo de novo não duplica linhas."
    fileLabel="Arquivo do extrato"
    accountLabel="Conta"
    accountFilter={(each) => each.type === "ACCOUNT"}
    types={[
      ["account-movements", "Extrato da conta"],
      ["receipt-movements", "Repasses da adquirente (esperados)"],
    ]}
  />
);

export const importInvoice = (context: ActionContext) => (
  <ImportDialog
    context={context}
    title="Importar fatura"
    description="O leitor é o definido para o cartão. Enviar a mesma fatura de novo não duplica linhas."
    fileLabel="Arquivo da fatura"
    accountLabel="Cartão"
    accountFilter={(each) => each.type === "CARD"}
    types={[["card-movements", "Fatura do cartão"]]}
  />
);

export const importRevenues = (context: ActionContext) => (
  <ImportDialog
    context={context}
    title="Importar receitas"
    description="O relatório de pagamentos do PDV (no caixa) ou as vendas da adquirente (na conta dela). A conta escolhida decide quem lê o arquivo. Enviar o mesmo arquivo de novo não duplica registros."
    fileLabel="Arquivo"
    accountLabel="Conta"
    accountFilter={(each) => each.type !== "CARD"}
    types={[["revenue-movements", "Receitas"]]}
  />
);
