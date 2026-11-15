/**
 * The file importer registry, shared by the import modules (ADR 13).
 *
 * An importer is identified by a stable id, a version and a fingerprint of
 * its configuration. The receiving module records that identity with every
 * file it takes in, so a file read by a changed parser or a customized format
 * is never confused with one read before the change. Bump `version` whenever
 * parsing or identity semantics change.
 *
 * Ported from `v1-horizontal:packages/application/src/modules/imports/registry.ts`
 * without its compatibility salt: the database is recreated, so every identity
 * carries its fingerprint. The digest uses the global Web Crypto API because
 * the kernel imports nothing but zod.
 */
import { LastroError } from "./errors";

export type ImporterConfiguration =
  | null
  | boolean
  | number
  | string
  | readonly ImporterConfiguration[]
  | { readonly [key: string]: ImporterConfiguration };

export type ImporterDefinition = Readonly<{
  /** Stable provenance identifier, independent of any file name. */
  id: string;
  /** A positive integer, incremented when parsing or identity changes. */
  version: number;
  /** Serializable settings; they are part of the importer's identity. */
  configuration?: ImporterConfiguration;
}>;

/** What a receiving module stores as a file's provenance. */
export type ImporterIdentity = Readonly<{
  id: string;
  version: number;
  /** sha256, hex, of the canonical `{ configuration, id, version }`. */
  fingerprint: string;
}>;

/**
 * A file is not the format its importer reads. Refuses the whole file, so a
 * malformed file writes nothing. Every parser throws this, naming the row.
 */
export class ImportFormatError extends LastroError {
  constructor(message: string) {
    super("IMPORT_FORMAT", message, 422);
    this.name = "ImportFormatError";
  }
}

export class ImporterNotFoundError extends LastroError {
  constructor(message: string) {
    super("UNKNOWN_IMPORTER", message, 422);
    this.name = "ImporterNotFoundError";
  }
}

const IMPORTER_ID = /^[a-z0-9][a-z0-9._/-]*$/;

/** JSON with sorted keys, so equal settings always hash alike. */
export function canonicalConfiguration(value: ImporterConfiguration): string {
  if (typeof value === "number" && !Number.isFinite(value))
    throw new Error("importer configuration numbers must be finite");
  if (Array.isArray(value))
    return `[${value.map(canonicalConfiguration).join(",")}]`;
  if (value !== null && typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype)
      throw new Error("importer configuration must be JSON data");
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${canonicalConfiguration(item)}`,
      )
      .join(",")}}`;
  }
  const result = JSON.stringify(value);
  if (result === undefined)
    throw new Error("importer configuration must be JSON data");
  return result;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export type ImporterRegistry<Importer extends ImporterDefinition> = Readonly<{
  list(): readonly Importer[];
  get(id: string): Importer;
  identity(id: string): Promise<ImporterIdentity>;
}>;

/** Instance scoped: one host's importers never leak into another's. */
export function createImporterRegistry<Importer extends ImporterDefinition>(
  importers: readonly Importer[],
): ImporterRegistry<Importer> {
  const byId = new Map<string, Importer>();
  for (const importer of importers) {
    if (
      !IMPORTER_ID.test(importer.id) ||
      !Number.isSafeInteger(importer.version) ||
      importer.version < 1
    )
      throw new Error(
        `importer ${importer.id} needs a stable id and a positive integer version`,
      );
    if (byId.has(importer.id))
      throw new Error(`duplicate importer: ${importer.id}`);
    // Fails early on settings that are not JSON data.
    canonicalConfiguration(importer.configuration ?? null);
    byId.set(importer.id, Object.freeze({ ...importer }));
  }
  const identities = new Map<string, Promise<ImporterIdentity>>();

  const get = (id: string): Importer => {
    const importer = byId.get(id);
    if (!importer) throw new ImporterNotFoundError(`unknown importer: ${id}`);
    return importer;
  };

  return Object.freeze({
    list: () => [...byId.values()],
    get,
    identity(id: string) {
      const importer = get(id);
      let identity = identities.get(id);
      if (!identity) {
        identity = sha256(
          canonicalConfiguration({
            configuration: importer.configuration ?? null,
            id: importer.id,
            version: importer.version,
          }),
        ).then((fingerprint) =>
          Object.freeze({
            id: importer.id,
            version: importer.version,
            fingerprint,
          }),
        );
        identities.set(id, identity);
      }
      return identity;
    },
  });
}

/**
 * Build an importer against a private, frozen copy of its settings, so a
 * caller cannot change a parser's behaviour after its identity was taken.
 */
export function configureImporter<
  Configuration extends ImporterConfiguration,
  Importer extends ImporterDefinition,
>(
  configuration: Configuration,
  build: (configuration: Configuration) => Omit<Importer, "configuration">,
): Importer {
  const freeze = (value: ImporterConfiguration): ImporterConfiguration => {
    if (value !== null && typeof value === "object") {
      for (const item of Object.values(value)) freeze(item);
      Object.freeze(value);
    }
    return value;
  };
  const settings = freeze(
    JSON.parse(canonicalConfiguration(configuration)),
  ) as Configuration;
  return Object.freeze({
    ...build(settings),
    configuration: settings,
  }) as unknown as Importer;
}
