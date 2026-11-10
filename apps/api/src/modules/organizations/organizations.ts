import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Post,
  Req,
  Param,
  ForbiddenException,
  NotFoundException,
  ParseUUIDPipe,
} from "@nestjs/common";
import { IsEmail, IsIn, IsString, Length } from "class-validator";
import { DataSource } from "typeorm";
import { randomBytes } from "node:crypto";
import { DB, rows, one, audit } from "../../common/database";
import { AuthRequest, Permission } from "../../common/security";
class OrganizationDto {
  @IsString() @Length(1, 100) name!: string;
}
class MemberDto {
  @IsEmail() email!: string;
  @IsIn(["ADMIN", "ANALYST", "VIEWER"]) role!: "ADMIN" | "ANALYST" | "VIEWER";
}
@Controller("organizations")
export class OrganizationsController {
  constructor(@Inject(DB) private db: DataSource) {}
  @Get() list(@Req() req: AuthRequest) {
    return rows(
      this.db,
      "SELECT o.*,m.role FROM organizations o JOIN organization_members m ON m.organization_id=o.id WHERE m.user_id=$1 AND o.status=$2 ORDER BY o.created_at",
      [req.principal.id, "ACTIVE"],
    );
  }
  @Post() create(@Req() req: AuthRequest, @Body() dto: OrganizationDto) {
    return this.db.transaction(async (db) => {
      const slug =
        dto.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .slice(0, 50) +
        "-" +
        randomBytes(4).toString("hex");
      const org = await one<{ id: string }>(
        db,
        "INSERT INTO organizations(name,slug) VALUES($1,$2) RETURNING *",
        [dto.name, slug],
      );
      await db.query(
        "INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$2,'OWNER')",
        [org!.id, req.principal.id],
      );
      await audit(
        db,
        org!.id,
        req.principal.id,
        "ORGANIZATION_CREATED",
        "organization",
        org!.id,
      );
      return org;
    });
  }
  @Permission("read") @Get(":id") async detail(
    @Req() req: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    this.match(req, id);
    return one(this.db, "SELECT * FROM organizations WHERE id=$1", [id]);
  }
  @Permission("read") @Get(":id/members") members(
    @Req() req: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    this.match(req, id);
    return rows(
      this.db,
      "SELECT m.id,m.role,u.email,u.display_name FROM organization_members m JOIN users u ON u.id=m.user_id WHERE m.organization_id=$1 ORDER BY u.email",
      [id],
    );
  }
  @Permission("configure") @Post(":id/invitations") async invite(
    @Req() req: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: MemberDto,
  ) {
    this.match(req, id);
    if (req.role === "ADMIN" && dto.role === "ADMIN")
      throw new ForbiddenException("Only owners can assign administrators");
    const user = await one<{ id: string }>(
      this.db,
      "SELECT id FROM users WHERE email=$1",
      [dto.email.toLowerCase()],
    );
    if (!user)
      throw new ForbiddenException("The user must register before being added");
    return this.db.transaction(async (db) => {
      await db.query(
        "INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(organization_id,user_id) DO NOTHING",
        [id, user.id, dto.role],
      );
      await audit(db, id, req.principal.id, "MEMBER_ADDED", "user", user.id, {
        role: dto.role,
      });
      return { ok: true };
    });
  }
  private match(req: AuthRequest, id: string) {
    if (req.organizationId !== id) throw new ForbiddenException();
  }
  @Permission("configure") @Post(":id/settings") async rename(
    @Req() r: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() d: OrganizationDto,
  ) {
    this.match(r, id);
    return this.db.transaction(async (db) => {
      await db.query(
        "UPDATE organizations SET name=$2,updated_at=now() WHERE id=$1",
        [id, d.name],
      );
      await audit(
        db,
        id,
        r.principal.id,
        "ORGANIZATION_RENAMED",
        "organization",
        id,
      );
      return { ok: true };
    });
  }
  @Permission("configure") @Delete(":id/members/:memberId") async removeMember(
    @Req() r: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("memberId", ParseUUIDPipe) memberId: string,
  ) {
    this.match(r, id);
    return this.db.transaction(async (db) => {
      const member = await one<{ role: string; user_id: string }>(
        db,
        "SELECT role,user_id FROM organization_members WHERE organization_id=$1 AND id=$2 FOR UPDATE",
        [id, memberId],
      );
      if (!member) throw new NotFoundException();
      if (
        member.role === "OWNER" ||
        (member.role === "ADMIN" && r.role !== "OWNER")
      )
        throw new ForbiddenException(
          "This member cannot be removed by your role",
        );
      await db.query(
        "DELETE FROM organization_members WHERE organization_id=$1 AND id=$2",
        [id, memberId],
      );
      await audit(
        db,
        id,
        r.principal.id,
        "MEMBER_REMOVED",
        "user",
        member.user_id,
      );
      return { ok: true };
    });
  }
  @Permission("owner") @Delete(":id") async close(
    @Req() r: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    this.match(r, id);
    return this.db.transaction(async (db) => {
      await audit(
        db,
        id,
        r.principal.id,
        "ORGANIZATION_CLOSED",
        "organization",
        id,
      );
      await db.query(
        "UPDATE organizations SET status='CLOSED',updated_at=now() WHERE id=$1",
        [id],
      );
      await db.query(
        "UPDATE reconciliation_schedules SET enabled=false WHERE organization_id=$1",
        [id],
      );
      await db.query(
        "UPDATE connections SET status='REVOKED',encrypted_secret_reference=NULL WHERE organization_id=$1",
        [id],
      );
      return { ok: true, retainedEvidence: true };
    });
  }
}
