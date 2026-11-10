import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getConfig } from "@usageaudit/config";
export class SecretEncryption {
  private key: Buffer;
  constructor(keyHex = getConfig().SECRET_ENCRYPTION_KEY) {
    if (!/^[a-fA-F0-9]{64}$/.test(keyHex))
      throw new Error("Encryption key must be 32 bytes");
    this.key = Buffer.from(keyHex, "hex");
  }
  encrypt(value: string, org: string) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(org));
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), ciphertext]
      .map((v) => v.toString("base64url"))
      .join(".");
  }
  decrypt(value: string, org: string) {
    const [iv, tag, ciphertext] = value
      .split(".")
      .map((v) => Buffer.from(v, "base64url"));
    if (!iv || !tag || !ciphertext) throw new Error("Invalid encrypted secret");
    const cipher = createDecipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(org));
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString(
      "utf8",
    );
  }
}
