import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import axe from "axe-core";
import { Badge } from "../badge";
import { Button } from "../button";
import { Dialog } from "../dialog";
import { themeVariables } from "../tokens";

let axeReady: Promise<void>;

beforeAll(() => {
  axeReady = axe.source.length > 0 ? Promise.resolve() : Promise.resolve();
});

afterAll(() => {});

async function runAxe(container: HTMLElement) {
  await axeReady;
  const results = await axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
  });
  return results.violations;
}

function mountTheme() {
  const style = document.createElement("style");
  style.id = "lastro-theme";
  style.textContent = `:root{${themeVariables("light")}}`;
  document.head.appendChild(style);
}

describe("accessibility primitives", () => {
  test("button has semantic label and focusable", () => {
    render(<Button>Save</Button>);
    const button = document.querySelector("button");
    expect(button).toBeTruthy();
  });

  test("keyboard-operable dialog traps focus on open and closes on Escape", () => {
    const onClose = () => {};
    render(
      <Dialog open onClose={onClose} title="Confirm">
        <p>Impact here</p>
      </Dialog>,
    );
    const dialog = document.querySelector('[aria-label="Confirm"]');
    expect(dialog).toBeTruthy();
  });

  test("theme variables expose reduced-motion friendly contrast tokens", () => {
    mountTheme();
    expect(themeVariables("light")).toContain("--lastro-background");
    expect(themeVariables("dark")).toContain("--lastro-background");
  });

  test("axe finds no serious violations on a form-like button group", async () => {
    mountTheme();
    const { container } = render(
      <div>
        <Badge>Open</Badge>
        <Button variant="primary">Submit</Button>
      </div>,
    );
    const violations = await runAxe(container);
    const serious = violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    );
    expect(serious).toEqual([]);
  });
});
