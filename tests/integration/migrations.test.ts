import { test } from "node:test";
import assert from "node:assert/strict";
import { createDataSource } from "../../apps/api/src/database/data-source";
test("all migrations apply, revert, and reapply on an empty real PostgreSQL database", async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source || !new URL(source).pathname.endsWith("_test"))
    throw new Error("Dedicated test database required");
  const url = new URL(source);
  url.pathname = "/usageaudit_migration_test";
  const admin = await createDataSource(source).initialize();
  const found = (await admin.query(
    "SELECT 1 FROM pg_database WHERE datname='usageaudit_migration_test'",
  )) as unknown[];
  if (!found.length)
    await admin.query("CREATE DATABASE usageaudit_migration_test");
  await admin.destroy();
  const db = await createDataSource(url.toString()).initialize();
  try {
    await db.runMigrations();
    const tables = (await db.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
    )) as { table_name: string }[];
    assert.ok(tables.some((t) => t.table_name === "usage_events"));
    await db.undoLastMigration();
    const missing = (await db.query(
      "SELECT to_regclass('public.usage_events') AS table",
    )) as { table: string | null }[];
    assert.equal(missing[0]!.table, null);
    await db.runMigrations();
    assert.equal(await db.showMigrations(), false);
  } finally {
    await db.destroy();
  }
});
