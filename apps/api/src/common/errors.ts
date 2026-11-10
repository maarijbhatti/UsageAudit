import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import type { Response } from "express";
import pino from "pino";
export const logger = pino({
  redact: [
    "password",
    "secret",
    "authorization",
    "cookie",
    "req.headers",
    "payload",
  ],
});
@Catch()
export class Errors implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const code = (e as { code?: string })?.code;
    const status =
      e instanceof HttpException
        ? e.getStatus()
        : ["23505", "23P01", "23514", "23503"].includes(code ?? "")
          ? 409
          : 500;
    const detail =
      e instanceof HttpException
        ? e.getResponse()
        : status === 409
          ? "Conflicting or invalid related record"
          : "Internal server error";
    if (status === 500)
      logger.error(
        { errorType: e instanceof Error ? e.name : "Unknown", code },
        "Request failed",
      );
    res.status(status).json({ error: { status, detail } });
  }
}
