import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { RateLimit } from "./common/rate-limit";
import type { Request, Response, NextFunction } from "express";
import { getConfig } from "@usageaudit/config";
import { AppModule } from "./app.module";
import { Errors, logger } from "./common/errors";
import { hash } from "./common/security";
export async function createApp() {
  const cfg = getConfig();
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn"],
  });
  app.setGlobalPrefix("api/v1");
  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new Errors());
  const redis = app.get(RateLimit).redis;
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin !== cfg.WEB_ORIGIN
    ) {
      res
        .status(403)
        .json({ error: { status: 403, detail: "Origin is not allowed" } });
      return;
    }
    if (req.path.startsWith("/api/v1/auth/") && req.method === "POST") {
      try {
        const key =
          "ratelimit:" +
          hash(req.ip ?? "unknown") +
          ":" +
          Math.floor(Date.now() / 60000);
        const count = Number(
          await redis.eval(
            "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",
            1,
            key,
          ),
        );
        if (count > 20) {
          res
            .status(429)
            .json({
              error: {
                status: 429,
                detail: "Too many requests; retry in a minute",
              },
            });
          return;
        }
      } catch {
        res
          .status(503)
          .json({
            error: {
              status: 503,
              detail: "Authentication temporarily unavailable",
            },
          });
        return;
      }
    }
    next();
  });
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("UsageAudit API")
      .setVersion("1.0")
      .addCookieAuth("ua_access")
      .addApiKey(
        { type: "apiKey", in: "header", name: "x-organization-id" },
        "organization",
      )
      .build(),
  );
  SwaggerModule.setup("api/docs", app, doc);
  app.enableShutdownHooks();
  return app;
}
if (require.main === module)
  void createApp()
    .then((app) => app.listen(getConfig().PORT, getConfig().HOST))
    .then(() => logger.info("API ready"))
    .catch((e) => {
      logger.error({
        message: e instanceof Error ? e.message : "Startup failed",
      });
      process.exitCode = 1;
    });
