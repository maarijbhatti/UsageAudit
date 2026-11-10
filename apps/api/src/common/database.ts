import {
  Global,
  Inject,
  Injectable,
  Module,
  OnModuleDestroy,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { createDataSource } from "../database/data-source";
export const DB = Symbol("DB");
@Injectable()
class DatabaseLifecycle implements OnModuleDestroy {
  constructor(@Inject(DB) private db: DataSource) {}
  async onModuleDestroy() {
    if (this.db.isInitialized) await this.db.destroy();
  }
}
@Global()
@Module({
  providers: [
    { provide: DB, useFactory: () => createDataSource().initialize() },
    DatabaseLifecycle,
  ],
  exports: [DB],
})
export class DatabaseModule {}
export async function rows<T>(
  db: DataSource | EntityManager,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return db.query(sql, params) as Promise<T[]>;
}
export async function one<T>(
  db: DataSource | EntityManager,
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  return (await rows<T>(db, sql, params))[0];
}
export async function audit(
  db: DataSource | EntityManager,
  org: string,
  user: string | null,
  action: string,
  resource: string,
  id: string | null,
  metadata: Record<string, unknown> = {},
) {
  await db.query(
    "INSERT INTO audit_logs(organization_id,actor_user_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5,$6)",
    [org, user, action, resource, id, JSON.stringify(metadata)],
  );
}
export async function enqueue(
  db: DataSource | EntityManager,
  org: string,
  kind: string,
  id: string,
  payload: Record<string, unknown> = {},
) {
  await db.query(
    "INSERT INTO job_outbox(organization_id,kind,resource_id,payload) VALUES($1,$2,$3,$4) ON CONFLICT(kind,resource_id) DO NOTHING",
    [org, kind, id, JSON.stringify(payload)],
  );
}
