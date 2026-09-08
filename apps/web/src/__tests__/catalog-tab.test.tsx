/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { type CatalogSpec, CatalogTab } from "@/components/catalog-tab";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";

const spec: CatalogSpec = {
  resource: "accounts",
  singular: "account",
  plural: "Accounts",
  fields: [
    { name: "key", label: "Key", required: true },
    { name: "name", label: "Name", required: true },
    { name: "type", label: "Type", required: true, options: ["CHECKING"] },
  ],
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

describe("catalog tab", () => {
  test("renders a row per record with edit and delete affordances", async () => {
    stubFetch([
      {
        id: "1",
        bookId: "1",
        key: "checking",
        name: "Checking",
        type: "CHECKING",
      },
    ]);
    render(<CatalogTab bookId="1" spec={spec} />);

    await waitFor(() => expect(screen.getByText("Checking")).toBeDefined());
    expect(screen.getByLabelText("Edit Checking")).toBeDefined();
    expect(screen.getByLabelText("Delete Checking")).toBeDefined();
  });

  test("shows an empty state rather than a bare table", async () => {
    stubFetch([]);
    render(<CatalogTab bookId="1" spec={spec} />);
    await waitFor(() =>
      expect(screen.getByText(/no accounts yet/i)).toBeDefined(),
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
    stubFetch([
      {
        id: "1",
        bookId: "1",
        key: "checking",
        name: "Checking",
        type: "CHECKING",
      },
    ]);
    const { container } = render(<CatalogTab bookId="1" spec={spec} />);
    await waitFor(() => expect(screen.getByText("Checking")).toBeDefined());

    const results = await axe.run(container);
    const serious = results.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    );
    expect(serious.map((violation) => violation.id)).toEqual([]);
  });
});

const slugSpec: CatalogSpec = {
  resource: "parties",
  singular: "party",
  plural: "Parties",
  fields: [
    { name: "name", label: "Name", required: true },
    { name: "key", label: "Key", required: true, slugFrom: "name" },
  ],
};

describe("key derived from name", () => {
  test("puts Name before Key, so the source is filled first", async () => {
    stubFetch([]);
    render(<CatalogTab bookId="1" spec={slugSpec} />);
    await waitFor(() => screen.getByRole("button", { name: /new party/i }));
    fireEvent.click(screen.getByRole("button", { name: /new party/i }));

    const labels = screen
      .getAllByText(/^(Name|Key)$/)
      .map((node) => node.textContent);
    expect(labels).toEqual(["Name", "Key"]);
  });

  test("fills the key from the name, slugified", async () => {
    stubFetch([]);
    render(<CatalogTab bookId="1" spec={slugSpec} />);
    await waitFor(() => screen.getByRole("button", { name: /new party/i }));
    fireEvent.click(screen.getByRole("button", { name: /new party/i }));

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Companhia de Água" },
    });
    expect((screen.getByLabelText("Key") as HTMLInputElement).value).toBe(
      "companhia-de-agua",
    );
  });

  test("stops suggesting once the key is edited by hand", async () => {
    stubFetch([]);
    render(<CatalogTab bookId="1" spec={slugSpec} />);
    await waitFor(() => screen.getByRole("button", { name: /new party/i }));
    fireEvent.click(screen.getByRole("button", { name: /new party/i }));

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Power Co" },
    });
    fireEvent.change(screen.getByLabelText("Key"), {
      target: { value: "utility" },
    });
    // A later rename must not clobber the operator's own key.
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Power Company" },
    });

    expect((screen.getByLabelText("Key") as HTMLInputElement).value).toBe(
      "utility",
    );
  });

  test("never rewrites an existing key when editing a record", async () => {
    stubFetch([{ id: "1", bookId: "1", key: "power-co", name: "Power Co" }]);
    render(<CatalogTab bookId="1" spec={slugSpec} />);
    await waitFor(() => screen.getByLabelText("Edit Power Co"));
    fireEvent.click(screen.getByLabelText("Edit Power Co"));

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Power Company Ltd" },
    });

    // Renaming must not silently change the identifier other records use.
    expect((screen.getByLabelText("Key") as HTMLInputElement).value).toBe(
      "power-co",
    );
  });
});
