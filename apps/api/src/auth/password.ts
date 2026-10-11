import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
const cost = 1 << 17;
const blockSize = 8;
const parallelism = 1;
const maxmem = 256 * 1024 * 1024;

function derive(
  password: string,
  salt: Buffer,
  length: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      length,
      { N: cost, r: blockSize, p: parallelism, maxmem },
      (error, derived) => (error ? reject(error) : resolve(derived)),
    );
  });
}

export function validatePassword(password: string): void {
  if (password.length < 12 || password.length > 1024) {
    throw new Error("Password must be between 12 and 1024 characters");
  }
}

export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);
  const salt = randomBytes(16);
  const derived = await derive(password, salt, 64);
  return `scrypt$${cost}$${blockSize}$${parallelism}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const fields = encoded.split("$");
  if (fields.length !== 6 || fields[0] !== "scrypt") return false;
  const [, n, r, p, saltText, hashText] = fields;
  if (
    Number(n) !== cost ||
    Number(r) !== blockSize ||
    Number(p) !== parallelism
  )
    return false;
  const salt = Buffer.from(saltText, "base64url");
  const expected = Buffer.from(hashText, "base64url");
  if (salt.length !== 16 || expected.length !== 64) return false;
  const actual = await derive(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}
