import { PortCrypto } from "../src/ports/port.crypto";

describe("port secret encryption", () => {
  const key = Buffer.alloc(32, 7).toString("base64");

  it("encrypts account details and document bytes with distinct authenticated nonces", () => {
    const crypto = new PortCrypto(key);
    const secret = Buffer.from("account-number-1234");
    const first = crypto.encrypt(secret);
    const second = crypto.encrypt(secret);
    expect(first).not.toEqual(second);
    expect(first.includes(secret)).toBe(false);
    expect(crypto.decrypt(first)).toEqual(secret);
    expect(crypto.decrypt(second)).toEqual(secret);
    const tampered = Buffer.from(first);
    tampered[tampered.length - 1] ^= 1;
    expect(() => crypto.decrypt(tampered)).toThrow();
  });

  it("rejects missing and incorrectly sized keys", () => {
    expect(() => new PortCrypto(undefined)).toThrow("encryption key");
    expect(() => new PortCrypto(Buffer.alloc(16).toString("base64"))).toThrow(
      "32 bytes",
    );
  });
});
