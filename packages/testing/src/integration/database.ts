/** The suite's database: always the one the runner created and exported. */
import { type Database, closeDb, createDb } from "@lastro/host";

export function openTestDb(): Database {
  const url = process.env.DATABASE_URL;
  if (!url?.endsWith("/lastro_integration")) {
    throw new Error(
      "integration tests run through `bun run test:integration`, against its own database",
    );
  }
  return createDb(url);
}

export { closeDb };
