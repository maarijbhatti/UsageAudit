import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { UploadCleanup } from '../../common/upload-cleanup';
import { IsIn, IsObject } from "class-validator";
import { DataSource } from "typeorm";
import { getConfig } from "@usageaudit/config";
import { ImportsService } from "./imports.service";
import { AuthRequest, Permission } from "../../common/security";
import { PageDto } from "../../common/pagination";
import { DB, one, rows } from "../../common/database";
class UploadDto {
  @IsIn(["APPLICATION_USAGE", "BILLING_USAGE", "INVOICE_LINES"])
  importType!: string;
}
class ConfirmDto {
  @IsObject() columnMapping!: Record<string, string>;
}
@Permission("read")
@Controller("imports")
export class ImportsController {
  constructor(
    @Inject(ImportsService) private service: ImportsService,
    @Inject(DB) private db: DataSource,
  ) {}
  @Get() async list(@Req() req: AuthRequest, @Query() p: PageDto) {
    const items = await rows(
      this.db,
      "SELECT * FROM import_batches WHERE organization_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
      [req.organizationId, p.pageSize, (p.page - 1) * p.pageSize],
    );
    const count = await one<{ total: number }>(
      this.db,
      "SELECT count(*)::int AS total FROM import_batches WHERE organization_id=$1",
      [req.organizationId],
    );
    return { items, total: count!.total, ...p };
  }
  @Permission("write")
  @Post()
  @HttpCode(202)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: diskStorage({ destination: ".local/uploads" }),
      limits: { fileSize: getConfig().UPLOAD_MAX_BYTES, files: 1, fields: 2 },
    }),
    UploadCleanup,
  )
  upload(
    @Req() req: AuthRequest,
    @Body() dto: UploadDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException("CSV file required");
    return this.service.upload(
      req.organizationId,
      req.principal.id,
      dto.importType,
      file,
    );
  }
  @Get(":id") detail(
    @Req() req: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.get(req.organizationId, id);
  }
  @Get(":id/preview") preview(
    @Req() req: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.preview(req.organizationId, id);
  }
  @Permission("write") @Post(":id/confirm") @HttpCode(202) confirm(
    @Req() req: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ConfirmDto,
  ) {
    return this.service.confirm(
      req.organizationId,
      req.principal.id,
      id,
      dto.columnMapping,
    );
  }
  @Get(":id/errors") async errors(
    @Req() req: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() p: PageDto,
  ) {
    await this.service.get(req.organizationId, id);
    const items = await rows(
      this.db,
      "SELECT row_number,validation_status,validation_errors,raw_payload FROM raw_import_records WHERE organization_id=$1 AND batch_id=$2 AND validation_status<>'ACCEPTED' ORDER BY row_number LIMIT $3 OFFSET $4",
      [req.organizationId, id, p.pageSize, (p.page - 1) * p.pageSize],
    );
    return { items, ...p };
  }
}
