import { startWorker } from "./runner";
void startWorker()
  .then((runtime) => {
    for (const signal of ["SIGTERM", "SIGINT"])
      process.once(signal, () => void runtime.close());
  })
  .catch((e) => {
    console.error(
      JSON.stringify({
        level: "error",
        message: e instanceof Error ? e.message : "Worker startup failed",
      }),
    );
    process.exitCode = 1;
  });
