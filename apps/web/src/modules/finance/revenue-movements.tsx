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
 * Revenue movements (docs/flows/yooga-payments.md, stone-sales.md): one
 * record per payment method and day, each up to four revenues: the gross,
 * the discount, the service fee and the acquirer's fee. A record posts on its
 * own once every component it carries has a filled descriptor; the rest wait
 * here.
 */
import {
  accounts,
  classifyRevenueMovementDescriptor,
  financialCategories,
  ignoreRevenueMovement,
  listRevenueMovementDescriptors,
  listRevenueMovements,
  parties,
  postRevenueMovement,
  undoRevenueMovement,
} from "@lastro/finance/contracts";
import { useState } from "react";

const COMPONENT_LABEL: Record<string, string> = {
  GROSS: "Bruto",
  DISCOUNT: "Desconto",
  FEE: "Taxa de serviço",
  ACQUIRER_FEE: "Taxa da adquirente",
};

const money = (value: unknown) => formatStatementAmount(String(value));

export function RevenueMovementsScreen({
  bookId,
  actions,
}: {
  bookId: string;
  actions: readonly ViewAction[];
}) {
  const [version, setVersion] = useState(0);
  const descriptors = useList(
    listRevenueMovementDescriptors,
    bookId,
    {},
    version,
  );
  const accountList = useList(accounts.list, bookId);
  const partyList = useList(parties.list, bookId);
  const categoryList = useList(financialCategories.list, bookId);
  const componentsOf = (record: Row) =>
    (descriptors.items ?? []).filter(
      (each) =>
        each.accountId === record.accountId &&
        String(each.descriptorKey).startsWith(`${record.methodKey}_`),
    );
  const amount = (header: string, field: string) => ({
    header,
    numeric: true,
    cell: (row: Row) => money(row[field]),
  });

  return (
    <EvidenceScreen
      bookId={bookId}
      title="Receitas importadas"
      emptyText="Nenhum registro."
      list={listRevenueMovements}
      columns={[
        { header: "Dia", cell: (row) => String(row.occurredOn) },
        { header: "Forma", cell: (row) => String(row.name) },
        { header: "Qtde", numeric: true, cell: (row) => String(row.quantity) },
        amount("Bruto", "gross"),
        amount("Desconto", "discount"),
        amount("Taxa", "fee"),
        amount("Taxa adquirente", "acquirerFee"),
        amount("A receber", "amount"),
      ]}
      post={postRevenueMovement}
      ignore={{
        operation: ignoreRevenueMovement,
        description: "O registro não vira receita. O motivo fica registrado.",
      }}
      undo={{
        operation: undoRevenueMovement,
        description:
          "O registro volta a pendente. As receitas que o lançamento criou continuam e são reaproveitadas no próximo lançamento.",
      }}
      actions={actions}
      renderClassify={(record, context) => (
        <ClassifyDialog
          bookId={bookId}
          record={record}
          components={componentsOf(record)}
          parties={partyList.items}
          accounts={accountList.items}
          categories={
            categoryList.items?.filter((each) => each.kind === "REVENUE") ??
            null
          }
          onClose={context.onClose}
          onDone={() => {
            setVersion((value) => value + 1);
            context.onDone();
          }}
        />
      )}
    />
  );
}

/* One party and category per component; each applies to every day of that method. */
function ClassifyDialog(props: {
  bookId: string;
  record: Row;
  components: Row[];
  parties: Row[] | null;
  categories: Row[] | null;
  accounts: Row[] | null;
  onClose: () => void;
  onDone: () => void;
}) {
  type Values = {
    partyId: string;
    financialCategoryId: string;
    settlementGroup: string;
    settlesMethodKey: string;
    receivedAccountId: string;
  };
  const [values, setValues] = useState<Record<string, Values>>(() =>
    Object.fromEntries(
      props.components.map((each) => [
        String(each.descriptorKey),
        {
          partyId: String(each.partyId ?? ""),
          financialCategoryId: String(each.financialCategoryId ?? ""),
          settlementGroup: String(each.settlementGroup ?? ""),
          settlesMethodKey: String(each.settlesMethodKey ?? ""),
          receivedAccountId: String(each.receivedAccountId ?? ""),
        },
      ]),
    ),
  );
  const set = (key: string, field: keyof Values, value: string) =>
    setValues((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? {
          partyId: "",
          financialCategoryId: "",
          settlementGroup: "",
          settlesMethodKey: "",
          receivedAccountId: "",
        }),
        [field]: value,
      },
    }));
  return (
    <FormDialog
      title="Classificar"
      description={
        <>
          Vale para todo dia de “{String(props.record.name)}” neste caixa: a
          parte e a categoria de cada componente. O desconto vai numa categoria
          de dedução. Os pendentes completos são lançados agora.
        </>
      }
      submit="Classificar e lançar"
      onClose={props.onClose}
      onSubmit={async (key) => {
        let index = 0;
        for (const each of props.components) {
          const descriptorKey = String(each.descriptorKey);
          const chosen = values[descriptorKey];
          if (!chosen?.partyId || !chosen.financialCategoryId) continue;
          index += 1;
          const optional = (value: string) => value.trim() || undefined;
          await call(
            classifyRevenueMovementDescriptor,
            {
              accountId: String(each.accountId),
              descriptorKey,
              partyId: chosen.partyId,
              financialCategoryId: chosen.financialCategoryId,
              settlementGroup: optional(chosen.settlementGroup),
              settlesMethodKey: optional(chosen.settlesMethodKey),
              receivedAccountId: optional(chosen.receivedAccountId),
            },
            { bookId: props.bookId, idempotencyKey: `${key}-${index}` },
          );
        }
        props.onDone();
        props.onClose();
      }}
    >
      {props.components.map((each) => {
        const descriptorKey = String(each.descriptorKey);
        const deduction = each.component === "DISCOUNT";
        return (
          <fieldset key={descriptorKey} className="space-y-2 border-t pt-2">
            <legend className="text-sm font-medium">
              {COMPONENT_LABEL[String(each.component)]}
            </legend>
            <SelectField
              id={`${descriptorKey}-party`}
              label="Parte"
              value={values[descriptorKey]?.partyId ?? ""}
              onChange={(value) => set(descriptorKey, "partyId", value)}
              options={optionsOf(props.parties)}
            />
            <SelectField
              id={`${descriptorKey}-category`}
              label={
                deduction
                  ? "Categoria financeira (dedução)"
                  : "Categoria financeira (receita)"
              }
              value={values[descriptorKey]?.financialCategoryId ?? ""}
              onChange={(value) =>
                set(descriptorKey, "financialCategoryId", value)
              }
              options={optionsOf(
                props.categories?.filter(
                  (category) => (category.role === "DEDUCTION") === deduction,
                ) ?? null,
              )}
            />
            {each.component === "ACQUIRER_FEE" ? (
              <>
                <TextField
                  id={`${descriptorKey}-group`}
                  label="Grupo do repasse que paga"
                  value={values[descriptorKey]?.settlementGroup ?? ""}
                  onChange={(value) =>
                    set(descriptorKey, "settlementGroup", value)
                  }
                />
                <TextField
                  id={`${descriptorKey}-method`}
                  label="Forma do PDV que o bruto liquida (ex.: debito)"
                  value={values[descriptorKey]?.settlesMethodKey ?? ""}
                  onChange={(value) =>
                    set(descriptorKey, "settlesMethodKey", value)
                  }
                />
              </>
            ) : null}
            {each.component === "GROSS" ? (
              <>
                <SelectField
                  id={`${descriptorKey}-received`}
                  label="Recebido no dia na conta (dinheiro)"
                  value={values[descriptorKey]?.receivedAccountId ?? ""}
                  onChange={(value) =>
                    set(descriptorKey, "receivedAccountId", value)
                  }
                  options={[["", "Não"], ...optionsOf(props.accounts)]}
                />
                <TextField
                  id={`${descriptorKey}-group`}
                  label="Ou pago por depósitos do grupo (vale)"
                  value={values[descriptorKey]?.settlementGroup ?? ""}
                  onChange={(value) =>
                    set(descriptorKey, "settlementGroup", value)
                  }
                />
              </>
            ) : null}
          </fieldset>
        );
      })}
    </FormDialog>
  );
}
