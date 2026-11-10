import { IsInt, IsOptional, Max, Min } from "class-validator";
import { Type } from "class-transformer";
export class PageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}
