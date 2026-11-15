/**
 * What only an installer with database access does: create identities and
 * Books, grant membership, issue credentials. These are not operations. No
 * surface publishes them, because each one decides who may act at all.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { InvalidRequestError, type Role } from "@lastro/kernel";
import { type AgentCredential, hashSecret } from "../domain/credentials";
import type { CorePort, EnvelopeStore } from "./port";

export function createAdmin(port: CorePort & EnvelopeStore) {
  return {
    getUserByEmail: port.getUserByEmail,
    createUser: port.createUser,
    listBooksOf: port.listBooksOf,

    /** The Book with this key, created if absent. */
    async ensureBook(input: { key: string; name: string }) {
      if (!input.key.trim() || !input.name.trim())
        throw new InvalidRequestError("a Book needs a key and a name");
      return (await port.getBookByKey(input.key)) ?? port.createBook(input);
    },

    setBookMember: port.setBookMember,

    /**
     * Issue a credential for `principal` acting as a member of the Book. The
     * token is returned once and stored only as a hash.
     */
    async issueAgentCredential(input: {
      bookId: string;
      principal: string;
      delegatedOperator: string;
      issuedBy: string;
    }): Promise<{ credential: AgentCredential; token: string; role: Role }> {
      if (!input.principal.trim())
        throw new InvalidRequestError("principal is required");
      const role = await port.getMembership(
        input.delegatedOperator,
        input.bookId,
      );
      if (!role)
        throw new InvalidRequestError(
          "the delegated operator is not a member of the Book",
        );
      const secret = randomBytes(32).toString("base64url");
      const credential = await port.transaction(async (handle) => {
        const created = await port.createAgentCredential(handle, {
          id: randomUUID(),
          bookId: input.bookId,
          principal: input.principal,
          delegatedOperator: input.delegatedOperator,
          secretHash: hashSecret(secret),
          revokedAt: null,
        });
        await port.insertAuditEvents(handle, [
          {
            actorType: "SYSTEM",
            actorPrincipal: input.issuedBy,
            delegatedOperator: input.issuedBy,
            bookId: input.bookId,
            source: "WORKER",
            correlationId: randomUUID(),
            operation: "core.admin.issueAgentCredential",
            action: "agent_credential.issued",
            resourceType: "agent_credential",
            resourceId: created.id,
            payload: {
              principal: created.principal,
              delegatedOperator: created.delegatedOperator,
            },
          },
        ]);
        return created;
      });
      return { credential, token: `${credential.id}.${secret}`, role };
    },
  };
}
