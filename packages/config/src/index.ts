import { z } from "zod";
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().default(4000),
  HOST: z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1"),
  WEB_ORIGIN: z.url(),
  DATABASE_URL: z.string().startsWith("postgres"),
  REDIS_URL: z.url(),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY: z.string().min(3),
  S3_SECRET_KEY: z.string().min(16),
  SECRET_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
  PROCESSING_DELAY_SECONDS: z.coerce.number().int().min(0).default(3600),
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(67108864)
    .default(33554432),
  IMPORT_MAX_ROWS: z.coerce
    .number()
    .int()
    .positive()
    .max(1000000)
    .default(200000),
});
export type Config = z.infer<typeof schema>;
export function getConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success)
    throw new Error(
      "Invalid environment: " +
        parsed.error.issues
          .map((i) => i.path.join(".") + " " + i.message)
          .join("; "),
    );
  if (
    parsed.data.NODE_ENV === "production" &&
    !parsed.data.WEB_ORIGIN.startsWith("https://")
  )
    throw new Error("Production WEB_ORIGIN requires HTTPS");
  return parsed.data;
}
