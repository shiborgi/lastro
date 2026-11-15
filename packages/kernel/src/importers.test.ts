/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  type ImporterDefinition,
  ImporterNotFoundError,
  canonicalConfiguration,
  configureImporter,
  createImporterRegistry,
} from "./importers";

type Example = ImporterDefinition & { parse(content: string): string[] };

const plain = (id: string, version = 1): Example => ({
  id,
  version,
  parse: (content) => content.split("\n"),
});

describe("importer registry", () => {
  test("refuses an unstable id, a bad version and a duplicate", () => {
    expect(() => createImporterRegistry([plain("Bank/Account")])).toThrow(
      "stable id",
    );
    expect(() => createImporterRegistry([plain("bank/account", 0)])).toThrow(
      "positive integer version",
    );
    expect(() =>
      createImporterRegistry([plain("bank/account"), plain("bank/account")]),
    ).toThrow("duplicate importer: bank/account");
  });

  test("an identity changes with the version and the configuration only", async () => {
    const build = (delimiter: string, version = 1) =>
      configureImporter<{ delimiter: string }, Example>(
        { delimiter },
        (settings) => ({
          id: "bank/account",
          version,
          parse: (content) => content.split(settings.delimiter),
        }),
      );
    const identity = (importer: Example) =>
      createImporterRegistry([importer]).identity("bank/account");

    const base = await identity(build(";"));
    expect(base.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(await identity(build(";"))).toEqual(base);
    expect((await identity(build(","))).fingerprint).not.toBe(base.fingerprint);
    expect((await identity(build(";", 2))).fingerprint).not.toBe(
      base.fingerprint,
    );
  });

  test("a configured importer's settings are a frozen copy", () => {
    const settings = { columns: ["Date", "Amount"] };
    const importer = configureImporter<typeof settings, Example>(settings, () =>
      plain("bank/account"),
    );
    settings.columns.push("Changed");
    expect(importer.configuration).toEqual({ columns: ["Date", "Amount"] });
    expect(Object.isFrozen(importer.configuration)).toBe(true);
  });

  test("canonical configuration sorts keys and refuses what is not JSON", () => {
    expect(canonicalConfiguration({ b: 1, a: [true, null] })).toBe(
      '{"a":[true,null],"b":1}',
    );
    expect(() => canonicalConfiguration(Number.NaN)).toThrow("finite");
    expect(() =>
      canonicalConfiguration(new Date() as unknown as string),
    ).toThrow("JSON data");
  });
});
