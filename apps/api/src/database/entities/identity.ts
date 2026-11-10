import { EntitySchema } from "typeorm";
export interface User {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}
export const UserEntity = new EntitySchema<User>({
  name: "User",
  tableName: "users",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid" },
    email: { type: "text", unique: true },
    passwordHash: { name: "password_hash", type: "text", select: false },
    displayName: { name: "display_name", type: "text" },
    status: { type: "text" },
    createdAt: { name: "created_at", type: "timestamptz", createDate: true },
    updatedAt: { name: "updated_at", type: "timestamptz", updateDate: true },
  },
});
export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}
export const OrganizationEntity = new EntitySchema<Organization>({
  name: "Organization",
  tableName: "organizations",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid" },
    name: { type: "text" },
    slug: { type: "text", unique: true },
    status: { type: "text" },
    createdAt: { name: "created_at", type: "timestamptz", createDate: true },
    updatedAt: { name: "updated_at", type: "timestamptz", updateDate: true },
  },
});
