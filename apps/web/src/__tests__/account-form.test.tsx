/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { type CatalogSpec, CatalogTab } from "@/components/catalog-tab";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/* The accounts spec as workspace.tsx declares it, minus the prose. */
const spec: CatalogSpec = {
  resource: "accounts",
  singular: "conta",
  plural: "Contas",
  fields: [
    { name: "name", label: "Nome", required: true },
    { name: "key", label: "Chave", required: true, slugFrom: "name" },
    {
      name: "type",
      label: "Tipo",
      required: true,
      options: [
        ["ACCOUNT", "Conta"],
        ["CARD", "Cartão"],
      ],
    },
    {
      name: "institutionId",
      label: "Instituição",
      optionsFrom: "institutions",
    },
    { name: "number", label: "Número" },
  ],
};

/* Exactly what the live API answers, per resource. */
const ACCOUNTS = [
  {
    id: "1",
    bookId: "2",
    key: "c6-conta",
    institutionId: "2",
    number: "295076852",
    name: "C6 Conta",
    type: "ACCOUNT",
  },
];
const INSTITUTIONS = [
  { id: "2", bookId: "2", key: "c6", name: "C6 Bank" },
  { id: "3", bookId: "2", key: "nubank", name: "Nubank" },
];

function stubByUrl() {
  const seen: string[] = [];
  globalThis.fetch = (async (url: string) => {
    seen.push(String(url));
    const items = String(url).includes("/institutions")
      ? INSTITUTIONS
      : ACCOUNTS;
    return new Response(JSON.stringify({ items }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return seen;
}

describe("institution on the account edit form", () => {
  test("the options load at all", async () => {
    const seen = stubByUrl();
    render(<CatalogTab bookId="2" spec={spec} />);
    await waitFor(() => screen.getByLabelText("Editar C6 Conta"));
    expect(seen.some((url) => url.includes("/institutions"))).toBe(true);
  });

  test("the table shows the institution name", async () => {
    stubByUrl();
    render(<CatalogTab bookId="2" spec={spec} />);
    await waitFor(() => expect(screen.getByText("C6 Bank")).toBeDefined());
  });

  test("the edit form offers the institutions", async () => {
    stubByUrl();
    render(<CatalogTab bookId="2" spec={spec} />);
    await waitFor(() => screen.getByText("C6 Bank"));
    fireEvent.click(screen.getByLabelText("Editar C6 Conta"));

    const select = screen.getByLabelText("Instituição") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "—",
      "C6 Bank",
      "Nubank",
    ]);
  });

  test("the account's own institution is the selected one", async () => {
    stubByUrl();
    render(<CatalogTab bookId="2" spec={spec} />);
    await waitFor(() => screen.getByText("C6 Bank"));
    fireEvent.click(screen.getByLabelText("Editar C6 Conta"));

    expect(
      (screen.getByLabelText("Instituição") as HTMLSelectElement).value,
    ).toBe("2");
  });
});

/*
 * The reason the institution looked missing: the account form grew a fifth
 * field, the centred dialog had no height cap, and a form taller than the
 * window extends past both edges with nothing to scroll — the fields at the
 * bottom and the submit button become unreachable.
 *
 * jsdom does not apply Tailwind, so this asserts the class that carries the
 * cap rather than a computed height. It pins the invariant; it cannot prove
 * the pixels.
 */
describe("the dialog cannot outgrow the window", () => {
  test("its content scrolls and is capped to the viewport", async () => {
    stubByUrl();
    render(<CatalogTab bookId="2" spec={spec} />);
    await waitFor(() => screen.getByLabelText("Editar C6 Conta"));
    fireEvent.click(screen.getByLabelText("Editar C6 Conta"));

    const content = document.querySelector('[data-slot="dialog-content"]');
    expect(content?.className).toContain("overflow-y-auto");
    expect(content?.className).toContain("max-h-[calc(100dvh-2rem)]");
  });
});
