/**
 * What the catalog screens are, declared once.
 *
 * These describe the resources `CatalogTab` renders — the fields, their
 * labels and the fixed choices each offers — and they live beside that
 * component rather than inside the shell that happens to route to it.
 */
import type { CatalogGroupSpec, CatalogSpec } from "@/components/catalog-tab";

/*
 * Every fixed choice the catalog offers, as `[value, label]`: the value is the
 * enum member the contract accepts, the label is what the operator reads. They
 * are written out here, next to each other, because the whole class of bug
 * they caused was a screen offering values the API had stopped accepting.
 */
const ACCOUNT_TYPES = [
  ["ACCOUNT", "Conta"],
  ["CARD", "Cartão"],
  ["INVESTMENT", "Investimento"],
  ["CASH", "Dinheiro"],
] as const;

const PARTY_TYPES = [
  ["PERSON", "Pessoa"],
  ["COMPANY", "Empresa"],
  ["GOVERNMENT", "Governo"],
  ["OTHER", "Outro"],
] as const;

export const ACCOUNTS: CatalogSpec = {
  resource: "accounts",
  singular: "conta",
  plural: "Contas",
  fields: [
    {
      name: "name",
      label: "Nome",
      required: true,
      placeholder: "Conta Corrente",
    },
    {
      name: "key",
      label: "Chave",
      required: true,
      slugFrom: "name",
      description: "Sugerida a partir do nome. Edite se quiser outra.",
    },
    /*
     * The four the database accepts, and nothing else. This select used to
     * offer CHECKING / SAVINGS / CREDIT_CARD, which no longer exist: opening
     * an ACCOUNT for editing showed CHECKING, and saving sent it.
     */
    {
      name: "type",
      label: "Tipo",
      required: true,
      options: ACCOUNT_TYPES,
    },
    {
      name: "institutionId",
      label: "Instituição",
      optionsFrom: "institutions",
    },
    {
      name: "number",
      label: "Número",
      placeholder: "12345-6",
      description:
        "Com a instituição, é o que a importação usa para reconhecer a conta. Do cartão, os quatro últimos dígitos.",
    },
  ],
};

export const CATALOGS: readonly CatalogSpec[] = [
  {
    resource: "institutions",
    singular: "instituição",
    plural: "Instituições",
    fields: [
      { name: "name", label: "Nome", required: true, placeholder: "Acme Bank" },
      {
        name: "key",
        label: "Chave",
        required: true,
        slugFrom: "name",
        description: "Sugerida a partir do nome. Edite se quiser outra.",
      },
    ],
  },
];

/*
 * Descriptors used to sit here as a fourth catalog. They moved to Revisão,
 * where the decision is actually made: a descriptor is not something you
 * register, it is something an import found and someone has to resolve.
 */
export const CATALOG_GROUPS: readonly CatalogGroupSpec[] = [
  {
    id: "accounts",
    title: "Contas",
    resources: [
      ACCOUNTS,
      {
        resource: "account-reference-months",
        singular: "ciclo",
        plural: "Ciclos de fatura",
        fields: [
          {
            name: "accountId",
            label: "Conta",
            required: true,
            optionsFrom: "accounts",
          },
          {
            name: "referenceMonth",
            label: "Fatura",
            required: true,
            date: true,
            description:
              "Qualquer dia do mês da fatura. É o mês que a promoção usa.",
          },
          {
            name: "startDate",
            label: "Compras de",
            required: true,
            date: true,
          },
          { name: "endDate", label: "até", required: true, date: true },
        ],
      },
    ],
  },

  {
    id: "parties",
    title: "Partes",
    resources: [
      {
        resource: "parties",
        singular: "parte",
        plural: "Partes",
        fields: [
          {
            name: "name",
            label: "Nome",
            required: true,
            placeholder: "Power Co",
          },
          {
            name: "key",
            label: "Chave",
            required: true,
            slugFrom: "name",
            description: "Sugerida a partir do nome. Edite se quiser outra.",
          },
          {
            name: "type",
            label: "Tipo",
            required: true,
            options: PARTY_TYPES,
          },
        ],
      },
    ],
  },
];
