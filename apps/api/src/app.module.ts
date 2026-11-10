import {
  Controller,
  Get,
  Inject,
  Module,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { APP_GUARD } from "@nestjs/core";
import { DatabaseModule, DB } from "./common/database";
import { AuthGuard, Public } from "./common/security";
import { AuthController, AuthService } from "./modules/auth/auth";
import { OrganizationsController } from "./modules/organizations/organizations";
import { DomainModule } from "./domain.module";
import { RateLimit } from "./common/rate-limit";
@Controller("health")
class HealthController {
  constructor(
    @Inject(DB) private db: DataSource,
    @Inject(RateLimit) private limiter: RateLimit,
  ) {}
  @Public() @Get() async health() {
    try {
      await Promise.all([this.db.query("SELECT 1"), this.limiter.redis.ping()]);
      return { status: "ok", service: "api", database: "ok", redis: "ok" };
    } catch {
      throw new ServiceUnavailableException("Required service is unavailable");
    }
  }
}
@Module({
  imports: [DatabaseModule, DomainModule],
  controllers: [HealthController, AuthController, OrganizationsController],
  providers: [
    AuthService,
    RateLimit,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
