import { create } from "zustand";

export interface SessionUser {
  id: string;
  email: string;
  roleKeys: string[];
  permissions: string[];
}

interface AuthState {
  status: "unknown" | "checking" | "authenticated" | "anonymous";
  accessToken: string | null;
  user: SessionUser | null;
  initialize: () => Promise<void>;
  refresh: () => Promise<boolean>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

interface SessionResponse {
  accessToken: string;
  user: SessionUser;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "unknown",
  accessToken: null,
  user: null,
  initialize: async () => {
    if (get().status !== "unknown") return;
    await get().refresh();
  },
  refresh: async () => {
    set({ status: "checking" });
    try {
      const response = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("No active session");
      const session = (await response.json()) as SessionResponse;
      set({
        status: "authenticated",
        accessToken: session.accessToken,
        user: session.user,
      });
      return true;
    } catch {
      set({ status: "anonymous", accessToken: null, user: null });
      return false;
    }
  },
  login: async (email, password) => {
    const response = await fetch("/api/v1/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      throw new Error(
        response.status === 429
          ? "Too many attempts. Please wait and try again."
          : "The email or password was not accepted.",
      );
    }
    const session = (await response.json()) as SessionResponse;
    set({
      status: "authenticated",
      accessToken: session.accessToken,
      user: session.user,
    });
  },
  logout: async () => {
    const token = get().accessToken;
    try {
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } finally {
      set({ status: "anonymous", accessToken: null, user: null });
    }
  },
}));
