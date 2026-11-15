import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // Every module brings its own tables (ADR 11); the host only gathers them.
  schema: "../../modules/*/src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // `generate` never connects; any command that does gets the throwaway
    // test database unless DATABASE_URL names another, never the 5432 default.
    url:
      process.env.DATABASE_URL ||
      "postgres://lastro:lastro@localhost:55432/lastro_integration",
  },
  verbose: true,
  strict: true,
});
