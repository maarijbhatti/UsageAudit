import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (existsSync(".env")) {
  console.log(".env already exists; preserved.");
} else {
  const password = randomBytes(24).toString("hex");
  const content = readFileSync(".env.example", "utf8")
    .replaceAll("CHANGE_ME", password)
    .replace("GENERATE_64_HEX_CHARACTERS", randomBytes(32).toString("hex"));
  writeFileSync(".env", content, { mode: 0o600 });
  console.log("Created .env with random local credentials.");
}
mkdirSync(".local/uploads", { recursive: true });
