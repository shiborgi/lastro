/**
 * Turning an authenticated caller into an execution context.
 *
 * Two ways in, one context out: a human arrives with a session and names a
 * Book; an agent arrives with a credential bound to one Book. Either way the
 * role comes from Book membership, never from the caller.
 */
import { randomUUID } from "node:crypto";
import type { ExecutionContext, Source, UserContext } from "@lastro/kernel";
import { type AgentCredential, verifySecret } from "../domain/credentials";
import type { CorePort } from "./port";

type RequestFacts = {
  source?: Source;
  correlationId?: string;
  idempotencyKey?: string;
};

export function createIdentity(port: CorePort) {
  return {
    /** Null when the user is not a member of the Book. */
    async contextForUser(
      input: { userId: string; bookId: string } & RequestFacts,
    ): Promise<ExecutionContext | null> {
      if (!input.userId.trim() || !input.bookId.trim()) return null;
      const role = await port.getMembership(input.userId, input.bookId);
      if (!role) return null;
      return {
        actorId: input.userId,
        bookId: input.bookId,
        role,
        source: input.source ?? "API",
        correlationId: input.correlationId ?? randomUUID(),
        idempotencyKey: input.idempotencyKey,
      };
    },

    /**
     * Null for every failure alike: unknown, revoked, wrong secret, another
     * Book, or an operator who is no longer a member. `bookId` is an optional
     * assertion; send it and a credential for another Book is refused.
     */
    async authenticateAgent(
      input: {
        credentialId: string;
        secret: string;
        bookId?: string;
      } & RequestFacts,
    ): Promise<{
      credential: AgentCredential;
      context: ExecutionContext;
    } | null> {
      if (!input.credentialId.trim() || !input.secret.trim()) return null;
      const credential = await port.getAgentCredential(input.credentialId);
      if (
        !credential ||
        credential.revokedAt ||
        (input.bookId !== undefined && credential.bookId !== input.bookId) ||
        !verifySecret(input.secret, credential.secretHash)
      ) {
        return null;
      }
      const role = await port.getMembership(
        credential.delegatedOperator,
        credential.bookId,
      );
      if (!role) return null;
      return {
        credential,
        context: {
          actorId: credential.delegatedOperator,
          bookId: credential.bookId,
          role,
          source: input.source ?? "MCP",
          correlationId: input.correlationId ?? randomUUID(),
          idempotencyKey: input.idempotencyKey,
          actorType: "ASSISTANT",
          agentPrincipal: credential.principal,
          delegatedOperator: credential.delegatedOperator,
        },
      };
    },

    /** A caller outside any Book, for user-scope operations. */
    userContext(
      input: { userId: string; agentPrincipal?: string } & RequestFacts,
    ): UserContext {
      return {
        actorId: input.userId,
        source: input.source ?? "API",
        correlationId: input.correlationId ?? randomUUID(),
        ...(input.agentPrincipal
          ? {
              actorType: "ASSISTANT" as const,
              agentPrincipal: input.agentPrincipal,
              delegatedOperator: input.userId,
            }
          : {}),
      };
    },
  };
}
