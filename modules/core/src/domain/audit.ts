/**
 * The append-only record every write commits with, naming the agent
 * principal and the operator it acts for.
 */
import type { ActorType, Source } from "@lastro/kernel";

export type AuditEvent = {
  id?: string;
  actorType: ActorType;
  actorPrincipal: string;
  delegatedOperator: string;
  bookId: string;
  source: Source;
  correlationId: string;
  /** The operation that ran, `<module>.<name>`. */
  operation: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  payload: Record<string, unknown>;
  createdAt?: Date;
};
