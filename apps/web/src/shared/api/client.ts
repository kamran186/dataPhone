import type { ApiError } from "@dataphone/shared";
import { useAuthStore } from "../../app/model/use-auth-store";

export async function authorizedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const fetchWithToken = () => {
    const token = useAuthStore.getState().accessToken;
    return fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: {
        ...init.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  };
  let response = await fetchWithToken();
  if (response.status === 401 && useAuthStore.getState().accessToken) {
    if (await useAuthStore.getState().refresh())
      response = await fetchWithToken();
  }
  return response;
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await authorizedFetch(path);
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
