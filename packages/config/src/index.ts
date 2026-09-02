import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine((value) => {
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    }, "DATABASE_URL is malformed"),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(input: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues.map((issue) => {
      const field = issue.path.join(".") || "(root)";
      return `${field}: ${issue.message}`;
    });
    throw new Error(`Invalid configuration: ${errors.join("; ")}`);
  }
  return result.data;
}

export function parseEnv(input: NodeJS.ProcessEnv = process.env): Env {
  try {
    return validateEnv(input);
  } catch (err: unknown) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
