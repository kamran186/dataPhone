export function normalizeE164(input: string): string {
  const normalized = input.replace(/[().\s-]/g, "");
  if (!/^\+[1-9]\d{1,14}$/.test(normalized)) {
    throw new Error("Phone number must be a valid E.164 value");
  }
  return normalized;
}
