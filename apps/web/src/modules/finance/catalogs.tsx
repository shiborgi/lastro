import type { Choice, ResourceSpec } from "@/shell/resource-screen";
/** Finance's catalogs, each a declaration over the shell's resource screen. */
import {
  accountCycles,
  accounts,
  financialCategories,
  institutions,
  parties,
} from "@lastro/finance/contracts";

type Row = { id: string } & Record<string, unknown>;
const named = (row: Row) => String(row.name ?? row.key ?? row.id);

export const ACCOUNT_TYPES: readonly Choice[] = [
  ["ACCOUNT", "Conta"],
  ["CARD", "Cartão"],
  ["INVESTMENT", "Investimento"],
  ["CASH", "Dinheiro"],
];
const PARTY_TYPES: readonly Choice[] = [
  ["PERSON", "Pessoa"],
  ["COMPANY", "Empresa"],
  ["GOVERNMENT", "Governo"],
  ["OTHER", "Outro"],
];
const KINDS: readonly Choice[] = [
  ["EXPENSE", "Despesa"],
  ["REVENUE", "Receita"],
];
const ROLES: readonly Choice[] = [
  ["FIXED", "Custo fixo"],
  ["MERCHANDISE", "Mercadoria"],
  ["DEDUCTION", "Dedução"],
];

const name = { name: "name", label: "Nome", required: true } as const;
const key = {
  name: "key",
  label: "Chave",
  required: true,
  slugFrom: "name",
  description: "Sugerida a partir do nome; é o identificador estável no Book.",
} as const;

export const INSTITUTIONS: ResourceSpec = {
  title: "Instituições",
  singular: "instituição",
  operations: institutions,
  fields: [name, key],
};

export const ACCOUNTS: ResourceSpec = {
  title: "Contas",
  singular: "conta",
  operations: accounts,
  fields: [
    name,
    key,
    {
      name: "type",
      label: "Tipo",
      required: true,
      kind: "select",
      options: ACCOUNT_TYPES,
      description:
        "Só dinheiro que o Book controla. Quem deve ao Book é uma parte, não uma conta.",
    },
    {
      name: "institutionId",
      label: "Instituição",
      kind: "reference",
      reference: { list: institutions.list, label: named },
    },
    {
      name: "number",
      label: "Número",
      description:
        "Como a instituição imprime; do cartão, os quatro últimos dígitos.",
    },
  ],
};

export const ACCOUNT_CYCLES: ResourceSpec = {
  title: "Janelas de fatura",
  singular: "janela",
  operations: accountCycles,
  fields: [
    {
      name: "accountId",
      label: "Cartão",
      required: true,
      kind: "reference",
      editable: false,
      reference: { list: accounts.list, label: named },
    },
    {
      name: "referenceMonth",
      label: "Fatura (mês)",
      required: true,
      kind: "date",
    },
    { name: "startsOn", label: "Compras de", required: true, kind: "date" },
    { name: "endsOn", label: "Compras até", required: true, kind: "date" },
    { name: "dueOn", label: "Vencimento", required: true, kind: "date" },
  ],
};

export const PARTIES: ResourceSpec = {
  title: "Partes",
  singular: "parte",
  operations: parties,
  fields: [
    name,
    key,
    {
      name: "type",
      label: "Tipo",
      required: true,
      kind: "select",
      options: PARTY_TYPES,
    },
  ],
};

export const FINANCIAL_CATEGORIES: ResourceSpec = {
  title: "Categorias financeiras",
  singular: "categoria financeira",
  operations: financialCategories,
  fields: [
    name,
    {
      name: "kind",
      label: "Natureza",
      required: true,
      kind: "select",
      options: KINDS,
    },
    {
      name: "parentId",
      label: "Grupo",
      kind: "reference",
      reference: { list: financialCategories.list, label: named },
      description:
        "Um nível só: um grupo reúne categorias e nunca recebe lançamentos.",
    },
    {
      name: "role",
      label: "Papel",
      kind: "select",
      options: ROLES,
      description:
        "Dedução: os itens são negativos (taxa sobre receita, desconto sobre despesa).",
    },
  ],
};
