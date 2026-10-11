import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./app";
import { useAuthStore } from "./model/use-auth-store";
import { useShellStore } from "./model/use-shell-store";

const user = {
  id: "507f1f77bcf86cd799439011",
  email: "admin@example.test",
  roleKeys: ["SUPER_ADMIN"],
  permissions: ["users.manage", "inventory.view", "customers.view"],
};

beforeEach(() => {
  useShellStore.setState({ menuOpen: false });
  window.history.replaceState({}, "", "/");
  useAuthStore.setState({
    status: "unknown",
    accessToken: null,
    user: null,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/auth/refresh")) return { ok: false, status: 401 };
      if (path.endsWith("/auth/login")) {
        return {
          ok: true,
          json: async () => ({ accessToken: "access-token", user }),
        };
      }
      if (path.endsWith("/system/info")) {
        return {
          ok: true,
          json: async () => ({
            name: "DataPhone",
            purpose: "Internal DID management",
          }),
        };
      }
      return { ok: false, status: 404 };
    }),
  );
});

it("hides user management and denies its route without permission", async () => {
  useAuthStore.setState({
    status: "authenticated",
    accessToken: "viewer-token",
    user: {
      ...user,
      roleKeys: ["VIEWER"],
      permissions: ["inventory.view", "customers.view"],
    },
  });
  window.history.replaceState({}, "", "/users");
  render(<App />);
  expect(
    await screen.findByText("You do not have access to this page."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
});

it("restores a browser session from the refresh cookie", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/auth/refresh")) {
        return {
          ok: true,
          json: async () => ({ accessToken: "restored", user }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          name: "DataPhone",
          purpose: "Internal DID management",
        }),
      };
    }),
  );
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "Overview" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Sign in" }),
  ).not.toBeInTheDocument();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("requires sign-in and then shows the protected overview", async () => {
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "Sign in" }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: /Work email/i }), {
    target: { value: "admin@example.test" },
  });
  fireEvent.change(screen.getByLabelText(/Password/i), {
    target: { value: "correct horse battery staple 42" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(
    await screen.findByRole("heading", { name: "Overview" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
  expect(
    screen.getByRole("navigation", { name: "Main navigation" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Users" })).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByText("Connected")).toBeInTheDocument(),
  );
});

it("shows recent jobs to staff with job viewing permission", async () => {
  useAuthStore.setState({
    status: "authenticated",
    accessToken: "staff-token",
    user: { ...user, permissions: [...user.permissions, "jobs.view"] },
  });
  window.history.replaceState({}, "", "/jobs");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () =>
        String(input).endsWith("/jobs")
          ? {
              items: [
                {
                  id: "job-1",
                  type: "system.noop",
                  status: "succeeded",
                  progress: 100,
                  attempts: 1,
                  maxAttempts: 3,
                  createdAt: "2026-10-11T00:00:00Z",
                },
              ],
            }
          : { name: "DataPhone", purpose: "Internal DID management" },
    })),
  );
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "Background jobs" }),
  ).toBeInTheDocument();
  expect(await screen.findByText("system.noop")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
  expect(screen.getByRole("link", { name: "Jobs" })).toBeInTheDocument();
});

it("shows synced numbers and their holding history", async () => {
  useAuthStore.setState({
    status: "authenticated",
    accessToken: "staff-token",
    user: {
      ...user,
      permissions: [...user.permissions, "inventory.manage", "sync.trigger"],
    },
  });
  window.history.replaceState({}, "", "/inventory");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      const data = path.includes("/numbers/number-1")
        ? {
            e164: "+18043024183",
            status: "active",
            carrier: "mock",
            carrierAccount: "fixture",
            firstSeenAt: "2026-10-11T00:00:00Z",
            lastSeenAt: "2026-10-11T00:00:00Z",
            holdings: [{ status: "active", startedAt: "2026-10-11T00:00:00Z" }],
            assignments: [],
          }
        : path.includes("/numbers?")
          ? {
              items: [
                {
                  id: "number-1",
                  e164: "+18043024183",
                  status: "active",
                  carrier: "mock",
                  updatedAt: "2026-10-11T00:00:00Z",
                },
              ],
              total: 1,
              pageSize: 50,
            }
          : path.endsWith("/carriers")
            ? [
                {
                  id: "carrier-1",
                  code: "mock",
                  displayName: "Mock",
                  capabilities: ["inventory.list"],
                  accounts: [
                    {
                      id: "account-1",
                      externalAccountId: "fixture",
                      status: "active",
                      lastSync: {
                        status: "succeeded",
                        startedAt: "2026-10-11T00:00:00Z",
                        seen: 1,
                        issues: 0,
                      },
                    },
                  ],
                },
              ]
            : path.includes("/reconciliation/issues")
              ? []
              : { name: "DataPhone", purpose: "Internal DID management" };
      return { ok: true, json: async () => data };
    }),
  );
  render(<App />);
  expect(
    await screen.findByRole("link", { name: "+18043024183" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/Latest sync succeeded/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "+18043024183" }));
  expect(
    await screen.findByRole("heading", { name: "Carrier holding history" }),
  ).toBeInTheDocument();
});
