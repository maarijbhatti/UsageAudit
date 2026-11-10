import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Post,
  Req,
  Res,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { IsEmail, IsString, Length } from "class-validator";
import { ApiProperty, ApiTags } from "@nestjs/swagger";
import { DataSource } from "typeorm";
import type { Request, Response } from "express";
import * as argon2 from "argon2";
import { randomUUID } from "node:crypto";
import { getConfig } from "@usageaudit/config";
import { DB, one } from "../../common/database";
import { UserEntity } from "../../database/entities/identity";
import { AuthRequest, hash, Public, token } from "../../common/security";
export class LoginDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty({ minLength: 12 })
  @IsString()
  @Length(12, 128)
  password!: string;
}
export class RegisterDto extends LoginDto {
  @ApiProperty() @IsString() @Length(1, 100) displayName!: string;
}
interface Session {
  id: string;
  user_id: string;
  csrf_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  family_id: string;
}
@Injectable()
export class AuthService {
  constructor(@Inject(DB) private db: DataSource) {}
  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });
    try {
      return await this.db
        .getRepository(UserEntity)
        .save({
          email,
          passwordHash,
          displayName: dto.displayName,
          status: "ACTIVE",
        });
    } catch (e) {
      if ((e as { code?: string }).code === "23505")
        throw new ConflictException("Account could not be created");
      throw e;
    }
  }
  async login(dto: LoginDto) {
    const user = await one<{ id: string; password_hash: string }>(
      this.db,
      "SELECT id,password_hash FROM users WHERE email=$1 AND status='ACTIVE'",
      [dto.email.trim().toLowerCase()],
    );
    if (!user || !(await argon2.verify(user.password_hash, dto.password)))
      throw new UnauthorizedException("Invalid email or password");
    return user;
  }
  async issue(
    userId: string,
    res: Response,
    familyId: string = randomUUID(),
    manager = this.db.manager,
  ) {
    const access = token(),
      refresh = token(),
      csrf = token();
    await manager.query(
      `INSERT INTO auth_sessions(user_id,access_token_hash,access_expires_at,refresh_token_hash,csrf_hash,expires_at,family_id) VALUES($1,$2,now()+interval '15 minutes',$3,$4,now()+interval '7 days',$5)`,
      [userId, hash(access), hash(refresh), hash(csrf), familyId],
    );
    const cookie = {
      httpOnly: true,
      secure: getConfig().NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
    };
    res.cookie("ua_access", access, { ...cookie, maxAge: 15 * 60 * 1000 });
    res.cookie("ua_refresh", refresh, { ...cookie, maxAge: 7 * 86400000 });
    res.cookie("ua_csrf", csrf, {
      ...cookie,
      httpOnly: false,
      maxAge: 7 * 86400000,
    });
    return { ok: true };
  }
  async refresh(req: Request, res: Response) {
    if (req.headers.origin !== getConfig().WEB_ORIGIN)
      throw new ForbiddenException("Invalid origin");
    const refresh: unknown = req.cookies?.ua_refresh;
    const csrf = req.headers["x-csrf-token"];
    if (typeof refresh !== "string" || typeof csrf !== "string")
      throw new UnauthorizedException();
    const outcome = await this.db.transaction(async (manager) => {
      const session = await one<Session>(
        manager,
        "SELECT * FROM auth_sessions WHERE refresh_token_hash=$1 FOR UPDATE",
        [hash(refresh)],
      );
      if (!session || session.csrf_hash !== hash(csrf)) return false;
      if (session.revoked_at) {
        await manager.query(
          "UPDATE auth_sessions SET revoked_at=now() WHERE family_id=$1",
          [session.family_id],
        );
        return false;
      }
      if (session.expires_at.getTime() < Date.now()) return false;
      await manager.query(
        "UPDATE auth_sessions SET revoked_at=now(),last_used_at=now() WHERE id=$1",
        [session.id],
      );
      await this.issue(session.user_id, res, session.family_id, manager);
      return true;
    });
    if (!outcome)
      throw new UnauthorizedException(
        "Session expired or refresh replay detected",
      );
    return { ok: true };
  }
  async logout(req: AuthRequest, res: Response) {
    await this.db.query(
      "UPDATE auth_sessions SET revoked_at=now() WHERE family_id=(SELECT family_id FROM auth_sessions WHERE id=$1)",
      [req.principal.sessionId],
    );
    for (const key of ["ua_access", "ua_refresh", "ua_csrf"])
      res.clearCookie(key, { path: "/" });
    return { ok: true };
  }
}
@ApiTags("Authentication")
@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private auth: AuthService) {}
  @Public() @Post("register") async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.auth.register(dto);
    return this.auth.issue(user.id, res);
  }
  @Public() @Post("login") async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.auth.login(dto);
    return this.auth.issue(user.id, res);
  }
  @Public() @Post("refresh") refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.refresh(req, res);
  }
  @Post("logout") logout(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.logout(req, res);
  }
  @Get("me") me(@Req() req: AuthRequest) {
    const { id, email, displayName } = req.principal;
    return { id, email, displayName };
  }
}
