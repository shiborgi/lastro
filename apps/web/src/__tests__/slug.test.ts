/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { slugify } from "@/lib/slug";

describe("slugify", () => {
  test("lowercases and joins words with hyphens", () => {
    expect(slugify("Conta Corrente")).toBe("conta-corrente");
    expect(slugify("Power Co")).toBe("power-co");
  });

  test("strips accents rather than the letters carrying them", () => {
    expect(slugify("Alimentação")).toBe("alimentacao");
    expect(slugify("Cartão de Crédito")).toBe("cartao-de-credito");
    expect(slugify("Água e Esgoto")).toBe("agua-e-esgoto");
  });

  test("collapses runs of separators into one hyphen", () => {
    expect(slugify("Casa   e    Jardim")).toBe("casa-e-jardim");
    expect(slugify("Banco / Itaú")).toBe("banco-itau");
  });

  test("does not leave a leading or trailing hyphen", () => {
    expect(slugify("  Moradia  ")).toBe("moradia");
    expect(slugify("¡Salário!")).toBe("salario");
  });

  test("keeps digits, which appear in real account names", () => {
    expect(slugify("Conta 2 — Reserva")).toBe("conta-2-reserva");
  });

  test("returns empty for input with nothing sluggable", () => {
    expect(slugify("")).toBe("");
    expect(slugify("— · —")).toBe("");
  });
});
