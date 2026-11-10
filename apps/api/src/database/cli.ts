import { createDataSource } from "./data-source";
async function main() {
  const db = await createDataSource().initialize();
  try {
    if (process.argv[2] === "revert") await db.undoLastMigration();
    else await db.runMigrations({ transaction: "all" });
    console.log("Migrations completed");
  } finally {
    await db.destroy();
  }
}
void main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Migration failed");
  process.exitCode = 1;
});
