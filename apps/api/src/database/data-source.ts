import "reflect-metadata";
import { DataSource } from "typeorm";
import { InitialSchema1793923200000 } from "./migrations/1793923200000-InitialSchema";
import { UserEntity, OrganizationEntity } from "./entities/identity";
export function createDataSource(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL required");
  return new DataSource({
    type: "postgres",
    url,
    synchronize: false,
    logging: false,
    entities: [UserEntity, OrganizationEntity],
    migrations: [InitialSchema1793923200000],
    extra: {
      max: 12,
      statement_timeout: 120000,
      connectionTimeoutMillis: 10000,
    },
  });
}
