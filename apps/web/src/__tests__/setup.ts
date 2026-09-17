import { afterEach, beforeEach } from "bun:test";
import { JSDOM } from "jsdom";

/*
 * Bun's runtime has no DOM, so component tests run against jsdom. Two things
 * about the wiring are load-bearing:
 *
 * 1. The globals must exist before @testing-library is evaluated — its `screen`
 *    helper binds to `document.body` at module load. ESM hoists imports, so
 *    testing-library is pulled in dynamically at the bottom of this file.
 *
 * 2. Every DOM class must come from *this* jsdom instance, because jsdom checks
 *    identity: an event built from the runtime's own `Event` is rejected as
 *    "not of type 'Event'". Rather than name each class, copy the constructors
 *    jsdom exposes — a hand-curated list runs out one class at a time
 *    (`NodeFilter`, then `HTMLInputElement`, …) as libraries reach for more.
 *
 * Only constructors and the few needed functions are copied. Reading every
 * window property instead would touch stateful getters such as `localStorage`,
 * which throws for jsdom's opaque default origin.
 */
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost",
});

const { window } = dom;

const isDomConstructor = (key: string) =>
  /^(HTML|SVG|DOM|CSS)/.test(key) ||
  [
    "Element",
    "Node",
    "NodeFilter",
    "NodeList",
    "Document",
    "DocumentFragment",
    "Range",
    "Text",
    "Comment",
    "MutationObserver",
    "ResizeObserver",
    "IntersectionObserver",
    "AbortSignal",
    "FormData",
    "File",
    "Blob",
  ].includes(key) ||
  key.endsWith("Event");

for (const key of Object.getOwnPropertyNames(window)) {
  if (!isDomConstructor(key)) continue;
  const value = Reflect.get(window, key);
  if (typeof value === "undefined") continue;
  Object.defineProperty(globalThis, key, {
    value,
    writable: true,
    configurable: true,
  });
}

Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
});

const { cleanup } = await import("@testing-library/react");

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  cleanup();
});
