/**
 * The append-only record every mutation writes, naming the agent principal and
 * the operator it acts for.
 */
import type { ActorType, Source } from "./authz";
export type AuditEvent = {
  id?: string;
  actorType: ActorType;
  actorPrincipal: string;
  delegatedOperator: string;
  bookId: string;
  source: Source;
  correlationId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  payload?: Record<string, unknown>;
  createdAt?: Date;
};
