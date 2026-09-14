import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  REDIS_PASSWORD: z.string().optional().default(""),
  RATE_LIMIT_ALGORITHM: z
    .enum(["token_bucket", "sliding_window_log", "sliding_window_counter"])
    .default("token_bucket"),
  RATE_LIMIT_FAIL_MODE: z.enum(["open", "closed"]).default("closed"),
  ADMIN_API_KEY: z.string().min(8, "ADMIN_API_KEY must be at least 8 characters"),
  WS_DECISION_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.04),
  METRICS_FLUSH_MS: z.coerce.number().int().positive().default(100)
});

export type AppEnv = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${details}`);
  }
  return parsed.data;
}

export const ALGORITHMS = [
  "token_bucket",
  "sliding_window_log",
  "sliding_window_counter"
] as const;

export type AlgorithmId = (typeof ALGORITHMS)[number];

export function isAlgorithmId(value: string): value is AlgorithmId {
  return (ALGORITHMS as readonly string[]).includes(value);
}
