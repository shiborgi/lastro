/**
 * The composition root (ADR 11): the ordered module list, the connection and
 * the single init assembled from every module's schema and triggers.
 */
export { type LastroHost, type Resources, createHost } from "./compose";
export { type Database, closeDb, createDb } from "./db";
export { initializeDatabase } from "./initialize";
export { type ModuleId, manifests, moduleOrder } from "./modules";
