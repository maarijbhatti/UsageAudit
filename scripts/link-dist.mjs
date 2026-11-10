import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { resolve } from "node:path";
for (const app of ["api", "worker"]) {
  mkdirSync(`dist/apps/${app}`, { recursive: true });
  const link = resolve(`dist/apps/${app}/node_modules`);
  if (!existsSync(link))
    symlinkSync(
      resolve(`apps/${app}/node_modules`),
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
}
