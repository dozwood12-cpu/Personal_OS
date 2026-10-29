import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
function key() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY || "";
  const bytes = /^[a-f\d]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (bytes.length !== 32)
    throw new Error(
      "TOKEN_ENCRYPTION_KEY harus 32 byte (64 karakter hex atau Base64).",
    );
  return bytes;
}
export function seal(value: string, context = "orbit:gdrive:refresh:v1") {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(context));
  const token_encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]).toString("base64");
  return {
    token_encrypted,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}
export function unseal(
  value: { token_encrypted: string; iv: string; tag: string },
  context = "orbit:gdrive:refresh:v1",
) {
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key(),
      Buffer.from(value.iv, "base64"),
    );
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(value.token_encrypted, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error(
      "Token Drive tidak dapat dibuka. Periksa TOKEN_ENCRYPTION_KEY atau hubungkan ulang Drive.",
    );
  }
}
