/** The real repository, read into the plain data the rules take. */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { moduleOrder } from "@lastro/host";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import type { ForeignKey, ModuleFacts, SourceFile } from "./rules";

export const ROOT = resolve(import.meta.dir, "../../../..");

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory())
      return ["node_modules", "dist"].includes(entry.name) ? [] : walk(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

export function sourceFiles(...dirs: string[]): SourceFile[] {
  return dirs.flatMap((dir) =>
    walk(resolve(ROOT, dir)).map((path) => ({
      path: relative(ROOT, path),
      source: readFileSync(path, "utf8"),
    })),
  );
}

/** Each module's direct module dependencies, from its package.json. */
export function packageDependencies(): Map<string, string[]> {
  const ids = new Set<string>(moduleOrder);
  return new Map(
    moduleOrder.map((id) => {
      const pkg = JSON.parse(
        readFileSync(resolve(ROOT, "modules", id, "package.json"), "utf8"),
      ) as { dependencies?: Record<string, string> };
      const direct = Object.keys(pkg.dependencies ?? {})
        .filter((name) => name.startsWith("@lastro/"))
        .map((name) => name.slice("@lastro/".length))
        .filter((name) => ids.has(name));
      return [id, direct];
    }),
  );
}

export function moduleFacts(): ModuleFacts[] {
  const direct = packageDependencies();
  const closure = (id: string, seen = new Set<string>()): Set<string> => {
    for (const dependency of direct.get(id) ?? []) {
      if (seen.has(dependency)) continue;
      seen.add(dependency);
      closure(dependency, seen);
    }
    return seen;
  };
  return moduleOrder.map((id) => ({ id, dependencies: [...closure(id)] }));
}

export async function tableOwners(): Promise<Map<string, string>> {
  const owners = new Map<string, string>();
  for (const id of moduleOrder) {
    const file = resolve(ROOT, "modules", id, "src/db/schema.ts");
    if (!existsSync(file)) continue;
    const schema = (await import(file)) as Record<string, unknown>;
    for (const value of Object.values(schema)) {
      if (is(value, PgTable)) owners.set(getTableName(value), id);
    }
  }
  return owners;
}

export function snapshotForeignKeys(): ForeignKey[] {
  const snapshot = JSON.parse(
    readFileSync(
      resolve(ROOT, "packages/host/drizzle/meta/0000_snapshot.json"),
      "utf8",
    ),
  ) as {
    tables: Record<
      string,
      {
        name: string;
        foreignKeys: Record<string, { name: string; tableTo: string }>;
      }
    >;
  };
  return Object.values(snapshot.tables).flatMap((table) =>
    Object.values(table.foreignKeys).map((key) => ({
      from: table.name,
      to: key.tableTo,
      name: key.name,
    })),
  );
}

/** Every `<id>Module` manifest the module packages export so far. */
export async function manifests() {
  const found: { id: string; dependsOn: readonly string[] }[] = [];
  for (const id of moduleOrder) {
    const exports = (await import(
      resolve(ROOT, "modules", id, "src/index.ts")
    )) as Record<string, unknown>;
    const manifest =
      exports[`${id.replace(/-(.)/g, (_, c) => c.toUpperCase())}Module`];
    if (manifest) found.push(manifest as { id: string; dependsOn: string[] });
  }
  return found;
}
