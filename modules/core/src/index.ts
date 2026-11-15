/** The core module: its manifest and public interface (ADR 11). */
import { defineModule } from "@lastro/kernel";
import { type CoreApi, createCore } from "./application/module";
import { coreOperations } from "./contracts";
import { type Db, createCoreRepository } from "./db";

export const coreModule = defineModule<{ db: Db }, object, CoreApi>({
  id: "core",
  dependsOn: [],
  operations: coreOperations,
  create: ({ resources }) => createCore(createCoreRepository(resources.db)),
});

export { type CoreApi, createCore } from "./application/module";
export { createEnvelope } from "./application/envelope";
export type {
  AuditQuery,
  CorePort,
  EnvelopeStore,
  User,
} from "./application/port";
export type { AuditEvent } from "./domain/audit";
export type { Book } from "./domain/books";
export {
  type AgentCredential,
  hashSecret,
  parseBearerCredential,
  verifySecret,
} from "./domain/credentials";
