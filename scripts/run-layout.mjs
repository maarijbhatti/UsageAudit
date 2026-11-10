import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";

const server = spawn(
  process.execPath,
  [
    "apps/web/node_modules/next/dist/bin/next",
    "start",
    "apps/web",
    "-p",
    "3200",
  ],
  {
    stdio: "inherit",
    windowsHide: true,
  },
);
const serverExit = once(server, "exit");
let runner;
function close() {
  runner?.kill();
  server.kill();
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null)
      throw new Error("Layout preview server exited before becoming ready");
    try {
      const response = await fetch("http://localhost:3200/login", {
        signal: AbortSignal.timeout(1000),
      });
      await response.body?.cancel();
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Server is still starting. */
    }
    await setTimeout(500);
  }
  if (!ready) throw new Error("Layout preview server did not become ready");
  runner = spawn(
    process.execPath,
    [
      "node_modules/@playwright/test/cli.js",
      "test",
      "--config",
      "playwright.layout.config.ts",
    ],
    { stdio: "inherit", windowsHide: true },
  );
  const [code] = await once(runner, "exit");
  process.exitCode = code ?? 1;
} finally {
  server.kill();
  await serverExit;
}
