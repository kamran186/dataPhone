import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = 1;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;

export class PortCrypto {
  private readonly key: Buffer;

  constructor(
    encodedKey: string | undefined = process.env.DATAPHONE_PORT_ENCRYPTION_KEY,
  ) {
    if (!encodedKey) throw new Error("Port encryption key is required");
    const key = Buffer.from(encodedKey, "base64");
    if (key.length !== 32 || key.toString("base64") !== encodedKey)
      throw new Error("Port encryption key must be exactly 32 bytes in base64");
    this.key = key;
  }

  encrypt(plain: Buffer): Buffer {
    const nonce = randomBytes(NONCE_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([
      Buffer.from([VERSION]),
      nonce,
      cipher.getAuthTag(),
      ciphertext,
    ]);
  }

  decrypt(sealed: Buffer): Buffer {
    if (sealed.length < 1 + NONCE_LENGTH + TAG_LENGTH || sealed[0] !== VERSION)
      throw new Error("Invalid encrypted port data");
    const nonce = sealed.subarray(1, 1 + NONCE_LENGTH);
    const tag = sealed.subarray(
      1 + NONCE_LENGTH,
      1 + NONCE_LENGTH + TAG_LENGTH,
    );
    const ciphertext = sealed.subarray(1 + NONCE_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv("aes-256-gcm", this.key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}
