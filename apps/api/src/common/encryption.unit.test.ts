import { it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { SecretEncryption } from "./secrets";
it("encrypted provider secrets are tenant-bound and tamper-resistant", () => {
  const secrets = new SecretEncryption(randomBytes(32).toString("hex"));
  const encrypted = secrets.encrypt("rk_test_fixture", "org-a");
  expect(secrets.decrypt(encrypted, "org-a")).toBe("rk_test_fixture");
  expect(() => secrets.decrypt(encrypted, "org-b")).toThrow();
  const parts = encrypted.split(".");
  parts[2] = Buffer.from("tampered").toString("base64url");
  expect(() => secrets.decrypt(parts.join("."), "org-a")).toThrow();
  expect(secrets.encrypt("rk_test_fixture", "org-a")).not.toBe(encrypted);
});
