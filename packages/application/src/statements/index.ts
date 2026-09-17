/**
 * The registry of bank statement plugins.
 *
 * Where the parser lives is a design decision, not an accident. It sits here,
 * beside the ledger, so that every caller gets the same reading of a file: the
 * MCP tool an agent drives, the web dashboard if someone drops a CSV into it,
 * a script. A parser living in the caller would have to be written once per
 * caller, and two implementations of one bank's format diverge — quietly, in
 * the direction of wrong numbers.
 *
 * What the caller does supply is the thing only it can: the bytes and the path
 * they came from. An agent reaching a Drive folder transports the file; it
 * never interprets its content.
 */
import { c6Account, c6Card } from "./c6";
import { nubankAccount } from "./nubank";
import { StatementFormatError, type StatementPlugin } from "./types";

export * from "./types";
export * from "./import";
export { CsvError, parseCsv, parseCsvRecords } from "./csv";
/*
 * The shape a new bank is written in. Adding one is: a file that calls
 * `defineCsvStatement` with that institution's own facts, and a line in
 * PLUGINS below. Nothing shared has to learn about it.
 */
export {
  type AccountStatementPlugin,
  type CardStatementPlugin,
  type Cells,
  defineCsvStatement,
} from "./csv-statement";
export { type MethodRule, inferPaymentMethod } from "./method";

const PLUGINS: StatementPlugin[] = [c6Card, c6Account, nubankAccount];

/** `c6/cartao/Fatura_2026-09-10.csv` → institution, kind, file name. */
export interface StatementPath {
  institutionKey: string;
  kind: string;
  fileName: string;
}

/**
 * Read the storage path. The layout is `<institution>/<kind>/<file>`, which is
 * what lets one folder tree serve several banks and both statement types
 * without any of it being configured twice.
 */
export function parseStatementPath(path: string): StatementPath {
  const segments = path.split("/").filter((segment) => segment !== "");
  if (segments.length < 3) {
    throw new StatementFormatError(
      `path must be <institution>/<kind>/<file>, got "${path}"`,
    );
  }
  // Read from the end, so a nested root (`drive/x/c6/cartao/f.csv`) still
  // resolves the right institution.
  const [fileName, kind, institutionKey] = segments.slice(-3).reverse();
  if (!fileName || !kind || !institutionKey) {
    throw new StatementFormatError(
      `path must be <institution>/<kind>/<file>, got "${path}"`,
    );
  }
  return { institutionKey, kind, fileName };
}

/**
 * The plugin for a path, or an error naming what is registered. Naming them is
 * the difference between "unsupported" and an operator knowing they put the
 * file in `cards/` when this tree uses `cartao/`.
 */
export function resolveStatementPlugin(path: string): {
  plugin: StatementPlugin;
  location: StatementPath;
} {
  const location = parseStatementPath(path);
  const id = `${location.institutionKey}/${location.kind}`;
  const plugin = PLUGINS.find((candidate) => candidate.id === id);
  if (!plugin) {
    throw new StatementFormatError(
      `no statement plugin for "${id}" (known: ${PLUGINS.map((p) => p.id).join(", ")})`,
    );
  }
  return { plugin, location };
}

export { c6Account, c6Card, nubankAccount };
