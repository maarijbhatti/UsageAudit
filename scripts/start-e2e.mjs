import { spawn } from "node:child_process";
process.loadEnvFile(".env");
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error("Dedicated TEST_DATABASE_URL required");
const env = {
  ...process.env,
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  PORT: "4100",
  WEB_ORIGIN: "http://localhost:3100",
  API_ORIGIN: "http://127.0.0.1:4100",
};
const commands = [
  ["dist/apps/api/src/main.js"],
  ["dist/apps/worker/src/main.js"],
  [
    "apps/web/node_modules/next/dist/bin/next",
    "start",
    "apps/web",
    "-p",
    "3100",
  ],
];
const children = commands.map((args) =>
  spawn(process.execPath, args, {
    env: {
      ...env,
      NODE_ENV: args[0].includes("/next/") ? "production" : "test",
    },
    stdio: "inherit",
    windowsHide: true,
  }),
);
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill();
}
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, close);
for (const child of children)
  child.on("exit", (code) => {
    if (!closing) {
      process.exitCode = code ?? 1;
      close();
    }
  });
