import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { DataSource } from "typeorm";
import { createHash, randomBytes } from "node:crypto";
import type { Role } from "@usageaudit/shared-types";
import { getConfig } from "@usageaudit/config";
import { DB, one } from "./database";
export const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export const Public = () => SetMetadata("public", true);
export const Permission = (value: "read" | "write" | "configure" | "owner") =>
  SetMetadata("permission", value);
export interface Principal {
  id: string;
  email: string;
  displayName: string;
  sessionId: string;
  csrfHash: string;
}
export interface AuthRequest extends Request {
  principal: Principal;
  organizationId: string;
  role: Role;
}
const permissions: Record<string, Role[]> = {
  read: ["OWNER", "ADMIN", "ANALYST", "VIEWER"],
  write: ["OWNER", "ADMIN", "ANALYST"],
  configure: ["OWNER", "ADMIN"],
  owner: ["OWNER"],
};
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(DB) private db: DataSource,
    @Inject(Reflector) private reflector: Reflector,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    if (
      this.reflector.getAllAndOverride<boolean>("public", [
        ctx.getHandler(),
        ctx.getClass(),
      ])
    )
      return true;
    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    const access: unknown = req.cookies?.ua_access;
    if (typeof access !== "string") throw new UnauthorizedException();
    const user = await one<Principal>(
      this.db,
      `SELECT u.id,u.email,u.display_name AS "displayName",s.id AS "sessionId",s.csrf_hash AS "csrfHash" FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.access_token_hash=$1 AND s.access_expires_at>now() AND s.expires_at>now() AND s.revoked_at IS NULL AND u.status='ACTIVE'`,
      [hash(access)],
    );
    if (!user) throw new UnauthorizedException();
    req.principal = user;
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const csrf = req.headers["x-csrf-token"];
      if (
        typeof csrf !== "string" ||
        hash(csrf) !== user.csrfHash ||
        req.headers.origin !== getConfig().WEB_ORIGIN
      )
        throw new ForbiddenException("Invalid CSRF token or origin");
    }
    const permission = this.reflector.getAllAndOverride<string>("permission", [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (permission) {
      const org = req.headers["x-organization-id"];
      if (typeof org !== "string" || !/^[0-9a-f-]{36}$/i.test(org))
        throw new ForbiddenException("Select an organization");
      const membership = await one<{ role: Role }>(
        this.db,
        `SELECT m.role FROM organization_members m JOIN organizations o ON o.id=m.organization_id WHERE m.organization_id=$1 AND m.user_id=$2 AND o.status='ACTIVE'`,
        [org, user.id],
      );
      if (!membership || !permissions[permission]?.includes(membership.role))
        throw new ForbiddenException("Insufficient organization permission");
      req.organizationId = org;
      req.role = membership.role;
    }
    return true;
  }
}
