/**
 * The module rules of ADR 11, as checks over source text and the generated
 * schema snapshot.
 *
 * They take plain data so each rule can be shown to fail on a fixture: a
 * fitness test that cannot fail protects nothing.
 */

export type SourceFile = {
  /** Repository-relative, e.g. `modules/finance/src/application/expenses.ts`. */
  path: string;
  source: string;
};

export type ModuleFacts = {
  id: string;
  /** Other business modules it may use, transitively closed. */
  dependencies: readonly string[];
};

type Import = { specifier: string; typeOnly: boolean };

const IMPORT =
  /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

export function importsOf(source: string): Import[] {
  return [...source.matchAll(IMPORT)].map((match) => ({
    specifier: (match[2] ?? match[3]) as string,
    typeOnly: Boolean(match[1]),
  }));
}

const isTest = (path: string) => /\.test\.tsx?$/.test(path);

/** `modules/<id>/src/<folder>/...` → its module and top-level folder. */
function locate(path: string) {
  const match = /^modules\/([^/]+)\/src\/(?:([^/]+)\/)?[^/]+/.exec(path);
  if (!match) return undefined;
  const file = path.slice(`modules/${match[1]}/src/`.length);
  return { module: match[1] as string, folder: match[2] ?? "", file };
}

const PURE_FOLDERS = new Set(["domain", "contracts", "application"]);
const DATABASE_PACKAGES = /^(drizzle-orm|postgres|pg)(\/|$)/;

export function importViolations(
  files: readonly SourceFile[],
  modules: readonly ModuleFacts[],
): string[] {
  const byId = new Map(modules.map((module) => [module.id, module]));
  const violations: string[] = [];

  for (const file of files) {
    const place = locate(file.path);
    if (!place) continue;
    const owner = byId.get(place.module);
    if (!owner) {
      violations.push(`${file.path}: module ${place.module} is not listed`);
      continue;
    }
    const pure = PURE_FOLDERS.has(place.folder);
    const refuse = (reason: string) =>
      violations.push(`${file.path}: ${reason}`);

    for (const { specifier, typeOnly } of importsOf(file.source)) {
      // Rule 1: domain, contracts and application never touch the database.
      if (pure && !isTest(file.path)) {
        if (DATABASE_PACKAGES.test(specifier))
          refuse(`${place.folder}/ imports the database package ${specifier}`);
        if (/(^|\/)db(\/|$)/.test(specifier))
          refuse(`${place.folder}/ imports a db folder: ${specifier}`);
      }

      // Rule 2: nothing in a module reaches into an app or another package's files.
      if (specifier.startsWith(".")) {
        const depth = place.file.split("/").length - 1;
        const ups = specifier.split("/").filter((part) => part === "..").length;
        if (ups > depth)
          refuse(`relative import leaves the module: ${specifier}`);
      }

      // Rule 3: contracts load in a browser.
      if (place.folder === "contracts" && !isTest(file.path)) {
        if (specifier.startsWith("node:") || specifier.startsWith("bun"))
          refuse(`contracts/ imports a server runtime module: ${specifier}`);
        if (/^\.\.\/application(\/|$)/.test(specifier))
          refuse(`contracts/ imports application code: ${specifier}`);
        if (/^\.\.\/domain(\/|$)/.test(specifier) && !typeOnly)
          refuse(`contracts/ may import domain types only: ${specifier}`);
      }

      // Rule 4: other modules through their public entry points, when declared.
      const lastro = /^@lastro\/([^/]+)(?:\/(.+))?$/.exec(specifier);
      if (!lastro) continue;
      const target = lastro[1] as string;
      const subpath = lastro[2];
      if (!byId.has(target)) {
        if (!["kernel"].includes(target))
          refuse(`imports ${specifier}, which is neither kernel nor a module`);
        continue;
      }
      if (target === place.module) {
        refuse(`imports its own package by name: ${specifier}`);
        continue;
      }
      if (!owner.dependencies.includes(target)) {
        refuse(`imports ${specifier} without depending on ${target}`);
        continue;
      }
      if (subpath === undefined || subpath === "contracts") continue;
      if (subpath === "db") {
        if (place.folder !== "db" && place.file !== "index.ts")
          refuse(`only db/ and the manifest may import ${specifier}`);
        continue;
      }
      if (subpath === "testing") {
        if (!isTest(file.path) && place.file !== "testing.ts")
          refuse(`only tests may import ${specifier}`);
        continue;
      }
      refuse(`imports a private path of ${target}: ${specifier}`);
    }
  }
  return violations;
}

/** The kernel is pure: no server runtime, no database, no module. */
export function kernelViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    if (!file.path.startsWith("packages/kernel/src/") || isTest(file.path))
      continue;
    for (const { specifier } of importsOf(file.source)) {
      if (specifier.startsWith(".") || specifier === "zod") continue;
      violations.push(`${file.path}: kernel imports ${specifier}`);
    }
  }
  return violations;
}

export type ForeignKey = { from: string; to: string; name: string };

/** A table may reference only its own module's tables or a dependency's. */
export function foreignKeyViolations(
  foreignKeys: readonly ForeignKey[],
  tableOwner: ReadonlyMap<string, string>,
  modules: readonly ModuleFacts[],
): string[] {
  const byId = new Map(modules.map((module) => [module.id, module]));
  const violations: string[] = [];
  for (const key of foreignKeys) {
    const from = tableOwner.get(key.from);
    const to = tableOwner.get(key.to);
    if (!from || !to) {
      violations.push(
        `${key.name}: table ${from ? key.to : key.from} belongs to no module`,
      );
      continue;
    }
    if (from === to || byId.get(from)?.dependencies.includes(to)) continue;
    violations.push(
      `${key.name}: ${from}.${key.from} references ${to}.${key.to}, and ${from} does not depend on ${to}`,
    );
  }
  return violations;
}

/** A manifest's `dependsOn` and its package's module dependencies agree. */
export function manifestViolations(
  manifests: readonly { id: string; dependsOn: readonly string[] }[],
  packageDependencies: ReadonlyMap<string, readonly string[]>,
  order: readonly string[],
): string[] {
  const violations: string[] = [];
  for (const manifest of manifests) {
    const declared = [...manifest.dependsOn].sort();
    const installed = [...(packageDependencies.get(manifest.id) ?? [])].sort();
    if (declared.join() !== installed.join())
      violations.push(
        `${manifest.id}: dependsOn [${declared}] differs from package.json [${installed}]`,
      );
    const position = order.indexOf(manifest.id);
    if (position === -1)
      violations.push(`${manifest.id}: missing from moduleOrder`);
    for (const dependency of manifest.dependsOn) {
      if (order.indexOf(dependency) >= position)
        violations.push(
          `${manifest.id}: depends on ${dependency}, which is not before it in moduleOrder`,
        );
    }
  }
  return violations;
}
