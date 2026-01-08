import crypto from "crypto";

function getKey(): Buffer {
  const keyB64 = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
  if (!keyB64) {
    throw new Error("Missing WHATSAPP_TOKEN_ENCRYPTION_KEY env var (base64-encoded 32 bytes)");
  }

  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) {
    throw new Error(
      `Invalid WHATSAPP_TOKEN_ENCRYPTION_KEY: expected 32 bytes after base64 decode, got ${key.length}`,
    );
  }

  return key;
}

export type EncryptedSecret = {
  ciphertextB64: string;
  ivB64: string;
  tagB64: string;
};

export function encryptSecret(plaintext: string, aad: string): EncryptedSecret {
  const key = getKey();
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertextB64: ciphertext.toString("base64"),
    ivB64: iv.toString("base64"),
    tagB64: tag.toString("base64"),
  };
}

export function decryptSecret(enc: EncryptedSecret, aad: string): string {
  const key = getKey();
  const iv = Buffer.from(enc.ivB64, "base64");
  const tag = Buffer.from(enc.tagB64, "base64");
  const ciphertext = Buffer.from(enc.ciphertextB64, "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

export function generateSixDigitPin(): string {
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(6, "0");
}
