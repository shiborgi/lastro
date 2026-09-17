/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { type CatalogSpec, CatalogTab } from "@/components/catalog-tab";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";

const spec: CatalogSpec = {
  resource: "accounts",
  singular: "conta",
  plural: "Contas",
  fields: [
    { name: "key", label: "Chave", required: true },
    { name: "name", label: "Nome", required: true },
    {
      name: "type",
      label: "Tipo",
      required: true,
      options: [
        ["ACCOUNT", "Conta"],
        ["CARD", "Cartão"],
      ],
    },
  ],
};

const account = {
  id: "1",
  bookId: "1",
  key: "conta-corrente",
  name: "Conta Corrente",
  type: "ACCOUNT",
};

/*
 * React augments the global `fetch` type with a `preconnect` property, so a
 * bare async function is not assignable to it. Going through `unknown` keeps
 * the stub honest about being a stub.
 */
function replaceFetch(handler: () => Promise<Response>) {
  globalThis.fetch = handler as unknown as typeof fetch;
}

function stubFetch(items: unknown[]) {
  replaceFetch(
    async () =>
      new Response(JSON.stringify({ items }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
}

/** Records what the form actually sends, which is where the bugs live. */
function recordingFetch(items: unknown[]) {
  const sent: { method: string; body: unknown }[] = [];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      sent.push({
        method,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(JSON.stringify(items[0] ?? {}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ items }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return sent;
}

describe("catalog tab", () => {
  test("renders a row per record with edit and delete affordances", async () => {
    stubFetch([account]);
    render(<CatalogTab bookId="1" spec={spec} />);

    await waitFor(() =>
      expect(screen.getByText("Conta Corrente")).toBeDefined(),
    );
    expect(screen.getByLabelText("Editar Conta Corrente")).toBeDefined();
    expect(screen.getByLabelText("Excluir Conta Corrente")).toBeDefined();
  });

  test("shows the label of a fixed choice, not the stored enum member", async () => {
    stubFetch([account]);
    render(<CatalogTab bookId="1" spec={spec} />);

    await waitFor(() => expect(screen.getByText("Conta")).toBeDefined());
    expect(screen.queryByText("ACCOUNT")).toBeNull();
  });

  test("shows an empty state rather than a bare table", async () => {
    stubFetch([]);
    render(<CatalogTab bookId="1" spec={spec} />);
    await waitFor(() =>
      expect(screen.getByText(/nada cadastrado ainda/i)).toBeDefined(),
    );
  });

  test("surfaces a failed load through role=alert", async () => {
    replaceFetch(
      async () =>
        new Response(JSON.stringify({ error: { message: "Book not found" } }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    );

    render(<CatalogTab bookId="1" spec={spec} />);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Book not found");
    });
  });

  test("has no serious accessibility violations, contrast included", async () => {
    stubFetch([account]);
    const { container } = render(<CatalogTab bookId="1" spec={spec} />);
    await waitFor(() =>
      expect(screen.getByText("Conta Corrente")).toBeDefined(),
    );

    const results = await axe.run(container);
    const serious = results.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    );
    expect(serious.map((violation) => violation.id)).toEqual([]);
  });
});

/*
 * The account form shipped offering CHECKING / SAVINGS / CREDIT_CARD after the
 * database had narrowed to CARD / ACCOUNT / INVESTMENT / CASH. A select whose
 * `defaultValue` matches no option falls back to the first one, so opening an
 * ACCOUNT for editing showed CHECKING and saving wrote it — no error anywhere,
 * because the allowlist of choices is a string the type system never compares
 * against the contract.
 */
describe("a stored value the form does not offer", () => {
  const drifted: CatalogSpec = {
    ...spec,
    fields: [
      { name: "name", label: "Nome", required: true },
      {
        name: "type",
        label: "Tipo",
        required: true,
        options: [["CARD", "Cartão"]],
      },
    ],
  };

  test("stays selected instead of falling back to the first option", async () => {
    stubFetch([account]);
    render(<CatalogTab bookId="1" spec={drifted} />);
    await waitFor(() => screen.getByLabelText("Editar Conta Corrente"));
    fireEvent.click(screen.getByLabelText("Editar Conta Corrente"));

    expect((screen.getByLabelText("Tipo") as HTMLSelectElement).value).toBe(
      "ACCOUNT",
    );
  });

  test("is offered by its own value, so it can be read", async () => {
    stubFetch([account]);
    render(<CatalogTab bookId="1" spec={drifted} />);
    await waitFor(() => screen.getByLabelText("Editar Conta Corrente"));
    fireEvent.click(screen.getByLabelText("Editar Conta Corrente"));

    const values = Array.from(
      (screen.getByLabelText("Tipo") as HTMLSelectElement).options,
    ).map((option) => option.value);
    expect(values).toContain("ACCOUNT");
  });
});

describe("a create-only field", () => {
  const aliasSpec: CatalogSpec = {
    resource: "party-aliases",
    singular: "descritor",
    plural: "Descritores",
    fields: [
      { name: "key", label: "Chave", required: true, createOnly: true },
      { name: "name", label: "Nome" },
    ],
  };

  test("is left out of the update, because the contract refuses it", async () => {
    const sent = recordingFetch([
      { id: "1", bookId: "1", key: "transf-pix", name: "Pix enviado" },
    ]);
    render(<CatalogTab bookId="1" spec={aliasSpec} />);
    await waitFor(() => screen.getByLabelText("Editar Pix enviado"));
    fireEvent.click(screen.getByLabelText("Editar Pix enviado"));

    fireEvent.change(screen.getByLabelText("Nome"), {
      target: { value: "Pix enviado a Power Co" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /salvar/i }));

    await waitFor(() => expect(sent.length).toBe(1));
    expect(sent[0]?.method).toBe("PATCH");
    expect(sent[0]?.body).toEqual({ name: "Pix enviado a Power Co" });
  });
});

const slugSpec: CatalogSpec = {
  resource: "parties",
  singular: "parte",
  plural: "Partes",
  fields: [
    { name: "name", label: "Nome", required: true },
    { name: "key", label: "Chave", required: true, slugFrom: "name" },
  ],
};

describe("key derived from name", () => {
  test("puts Nome before Chave, so the source is filled first", async () => {
    stubFetch([]);
    render(<CatalogTab bookId="1" spec={slugSpec} />);
    await waitFor(() => screen.getByRole("button", { name: /adicionar/i }));
    fireEvent.click(screen.getByRole("button", { name: /adicionar/i }));

    const labels = screen
      .getAllByText(/^(Nome|Chave)$/)
      .map((node) => node.textContent);
    expect(labels).toEqual(["Nome", "Chave"]);
  });

  test("fills the key from the name, slugified", async () => {
    stubFetch([]);
    render(<CatalogTab bookId="1" spec={slugSpec} />);
    await waitFor(() => screen.getByRole("button", { name: /adicionar/i }));
    fireEvent.click(screen.getByRole("button", { name: /adicionar/i }));

    fireEvent.change(screen.getByLabelText("Nome"), {
      target: { value: "Companhia de Água" },
    });
    expect((screen.getByLabelText("Chave") as HTMLInputElement).value).toBe(
      "companhia-de-agua",
    );
  });

  test("stops suggesting once the key is edited by hand", async () => {
    stubFetch([]);
    render(<CatalogTab bookId="1" spec={slugSpec} />);
    await waitFor(() => screen.getByRole("button", { name: /adicionar/i }));
    fireEvent.click(screen.getByRole("button", { name: /adicionar/i }));

    fireEvent.change(screen.getByLabelText("Nome"), {
      target: { value: "Power Co" },
    });
    fireEvent.change(screen.getByLabelText("Chave"), {
      target: { value: "utility" },
    });
    // A later rename must not clobber the operator's own key.
    fireEvent.change(screen.getByLabelText("Nome"), {
      target: { value: "Power Company" },
    });

    expect((screen.getByLabelText("Chave") as HTMLInputElement).value).toBe(
      "utility",
    );
  });

  test("never rewrites an existing key when editing a record", async () => {
    stubFetch([{ id: "1", bookId: "1", key: "power-co", name: "Power Co" }]);
    render(<CatalogTab bookId="1" spec={slugSpec} />);
    await waitFor(() => screen.getByLabelText("Editar Power Co"));
    fireEvent.click(screen.getByLabelText("Editar Power Co"));

    fireEvent.change(screen.getByLabelText("Nome"), {
      target: { value: "Power Company Ltd" },
    });

    // Renaming must not silently change the identifier other records use.
    expect((screen.getByLabelText("Chave") as HTMLInputElement).value).toBe(
      "power-co",
    );
  });
});
