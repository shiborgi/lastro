/**
 * The domain layer: entities, value objects and the invariants over them.
 *
 * This package depends on nothing. If a rule is worth enforcing it lives here
 * and every adapter inherits it — a route, an MCP tool or a component that
 * decides a financial outcome on its own is a bug.
 */
export * from "./authz";
export * from "./audit";
export * from "./catalog";
export * from "./errors";
export * from "./financial";
export * from "./money";
export * from "./movements";
