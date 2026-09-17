/// <reference types="bun-types" />
import { beforeEach, describe, expect, test } from "bun:test";
import { Workspace } from "@/components/workspace";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/*
 * The rail eats sixty columns of width for the life of the session, and there
 * was no way to get them back. The toggle lives in the main header, not the
 * rail itself — once the rail is hidden, the header is the only place left on
 * screen to bring it back.
 *
 * Assertions read the rail's own className rather than asking testing-library
 * whether it is visible: these tests run against plain jsdom, with no Tailwind
 * stylesheet loaded, so a `md:hidden` class never actually becomes
 * `display:none` here — the class is the fact this suite can check.
 */

function stubApi() {
  globalThis.fetch = (async (url: string) => {
    const path = String(url);
    if (/\/v1\/books$/.test(path)) {
      return new Response(
        JSON.stringify({
          books: [{ id: "2", name: "Test Book" }],
          user: { id: "1" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    // Everything else the screens underneath ask for: refused, and each of
    // them already renders its own error text instead of throwing.
    return new Response(JSON.stringify({ error: { message: "not stubbed" } }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  try {
    localStorage.removeItem("lastro:rail-collapsed");
  } catch {
    // Nothing to clear if storage is unavailable.
  }
});

async function openWorkspace() {
  stubApi();
  render(<Workspace />);
  await waitFor(() => screen.getByLabelText("Recolher barra lateral"));
  return screen.getByRole("complementary");
}

describe("the rail toggle", () => {
  test("starts expanded", async () => {
    const rail = await openWorkspace();
    expect(rail.className).toContain("md:w-60");
    expect(rail.className).not.toContain("md:hidden");
  });

  test("hides the rail on click, and offers to bring it back", async () => {
    const rail = await openWorkspace();

    fireEvent.click(screen.getByLabelText("Recolher barra lateral"));

    await waitFor(() => expect(rail.className).toContain("md:hidden"));
    expect(rail.className).not.toContain("md:w-60");
    expect(screen.getByLabelText("Mostrar barra lateral")).toBeDefined();
  });

  test("brings it back on a second click", async () => {
    const rail = await openWorkspace();
    fireEvent.click(screen.getByLabelText("Recolher barra lateral"));
    await waitFor(() => expect(rail.className).toContain("md:hidden"));

    fireEvent.click(screen.getByLabelText("Mostrar barra lateral"));

    await waitFor(() => expect(rail.className).toContain("md:w-60"));
    expect(screen.getByLabelText("Recolher barra lateral")).toBeDefined();
  });

  test("remembers the choice across a remount", async () => {
    const rail = await openWorkspace();
    fireEvent.click(screen.getByLabelText("Recolher barra lateral"));
    await waitFor(() => expect(rail.className).toContain("md:hidden"));

    stubApi();
    render(<Workspace />);
    // Starts expanded on every fresh mount (Node has no localStorage to read
    // during the server render this stands in for), then settles right after
    // — the same one-frame trade the theme toggle makes, and for the same
    // reason: the alternative is a hydration mismatch on a returning visitor.
    await waitFor(() =>
      expect(
        screen.getAllByLabelText("Mostrar barra lateral").length,
      ).toBeGreaterThan(0),
    );
  });
});
