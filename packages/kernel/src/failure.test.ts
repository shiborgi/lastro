/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { ForbiddenError, LastroError } from "./errors";
import { databaseRefusal, toFailure } from "./failure";

/* The shape drizzle gives a driver failure: the SQLSTATE one level down. */
function wrapped(code: string, message: string) {
  return new Error("Failed query: insert into ...", {
    cause: Object.assign(new Error(message), { code }),
  });
}

describe("toFailure", () => {
  test("a LastroError keeps its status, code, message and details", () => {
    expect(toFailure(new ForbiddenError())).toEqual({
      status: 403,
      code: "FORBIDDEN",
      message: "FORBIDDEN",
    });
    expect(
      toFailure(
        new LastroError("DAY_POSTED", "already posted", 409, {
          day: "2026-11-07",
        }),
      ),
    ).toEqual({
      status: 409,
      code: "DAY_POSTED",
      message: "already posted",
      details: { day: "2026-11-07" },
    });
  });

  test("a zod failure names each field", () => {
    const parsed = z
      .object({ amount: z.string(), party: z.object({ id: z.string() }) })
      .safeParse({ amount: 1, party: {} });
    if (parsed.success) throw new Error("fixture");
    const failure = toFailure(parsed.error);
    expect(failure.status).toBe(400);
    expect(failure.code).toBe("INVALID_REQUEST");
    expect(failure.message).toContain("amount: ");
    expect(failure.message).toContain("party.id: ");
    expect(failure.details?.issues).toHaveLength(2);
  });

  test("a trigger's refusal keeps its words", () => {
    const error = wrapped("23514", "expense settlements exceed expense total");
    expect(databaseRefusal(error)).toBe(
      "expense settlements exceed expense total",
    );
    expect(toFailure(error)).toEqual({
      status: 409,
      code: "CONFLICT",
      message: "expense settlements exceed expense total",
    });
  });

  test("a foreign-key or unique violation is a conflict without SQL", () => {
    expect(toFailure(wrapped("23503", 'violates "expenses_party_fk"'))).toEqual(
      {
        status: 409,
        code: "CONFLICT",
        message: "the record is still referenced by another record",
      },
    );
    expect(
      toFailure(
        wrapped(
          "23503",
          'insert or update on table "expenses" violates foreign key constraint',
        ),
      ).message,
    ).toBe("a record it references does not exist in this Book");
    expect(toFailure(wrapped("23505", "duplicate key")).message).toBe(
      "a record with the same identity already exists",
    );
  });

  test("anything else is a 500 that withholds its message", () => {
    for (const error of [
      new Error("select * from secrets"),
      wrapped("42P01", 'relation "x" does not exist'),
      "text",
      null,
    ]) {
      expect(toFailure(error)).toEqual({
        status: 500,
        code: "INTERNAL",
        message: "internal error",
      });
    }
  });
});
