import type { ApiError } from "@dataphone/shared";

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin" });
  if (!response.ok) {
    let body: Partial<ApiError> = {};
    try {
      body = (await response.json()) as Partial<ApiError>;
    } catch {
      /* A proxy or network error may not be JSON. */
    }
    throw new Error(body.message ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}
