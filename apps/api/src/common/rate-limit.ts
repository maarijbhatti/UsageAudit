import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";
import { getConfig } from "@usageaudit/config";
@Injectable()
export class RateLimit implements OnModuleDestroy {
  readonly redis = new Redis(getConfig().REDIS_URL, {
    maxRetriesPerRequest: 1,
  });
  async onModuleDestroy() {
    await this.redis.quit();
  }
}
