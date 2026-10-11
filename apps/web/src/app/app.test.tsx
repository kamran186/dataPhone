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

it("creates a customer from the customer management page", async () => {
  useAuthStore.setState({
    status: "authenticated",
    accessToken: "staff-token",
    user: { ...user, permissions: [...user.permissions, "customers.manage"] },
  });
  window.history.replaceState({}, "", "/customers");
  const rows: Array<{
    id: string;
    name: string;
    externalId: string;
    status: string;
    version: number;
  }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/customers") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          name: string;
          externalId: string;
        };
        rows.push({
          id: "507f1f77bcf86cd799439012",
          name: body.name,
          externalId: body.externalId,
          status: "active",
          version: 1,
        });
        return { ok: true, status: 201, json: async () => rows[0] };
      }
      if (path.includes("/customers?"))
        return {
          ok: true,
          json: async () => ({ items: rows, total: rows.length, pageSize: 25 }),
        };
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
  fireEvent.click(await screen.findByRole("button", { name: "Add customer" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Customer name" }), {
    target: { value: "Acme West" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "External ID" }), {
    target: { value: "acme-west" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create customer" }));
  expect(
    await screen.findByRole("link", { name: "Acme West" }),
  ).toBeInTheDocument();
});

it("opens customer numbers and audited history", async () => {
  useAuthStore.setState({
    status: "authenticated",
    accessToken: "staff-token",
    user: {
      ...user,
      permissions: [...user.permissions, "audit.view", "customers.manage"],
    },
  });
  window.history.replaceState({}, "", "/customers/507f1f77bcf86cd799439012");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      const data = path.includes("/history")
        ? {
            items: [
              {
                id: "event-1",
                type: "customer.created",
                actorId: user.id,
                sequence: 1,
                createdAt: "2026-10-11T00:00:00Z",
                previous: null,
                next: { name: "Acme West" },
              },
            ],
            total: 1,
            pageSize: 25,
          }
        : path.includes("/numbers")
          ? {
              items: [
                {
                  id: "507f1f77bcf86cd799439013",
                  e164: "+18043024183",
                  status: "active",
                },
              ],
              total: 1,
              pageSize: 25,
            }
          : path.includes("/customers/")
            ? {
                id: "507f1f77bcf86cd799439012",
                name: "Acme West",
                externalId: "acme-west",
                status: "active",
                version: 1,
              }
            : { name: "DataPhone", purpose: "Internal DID management" };
      return { ok: true, json: async () => data };
    }),
  );
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "Acme West" }),
  ).toBeInTheDocument();
  expect(
    await screen.findByRole("link", { name: "+18043024183" }),
  ).toBeInTheDocument();
  expect(await screen.findByText("customer.created")).toBeInTheDocument();
});

it("assigns an inventory number to a selected customer", async () => {
  useAuthStore.setState({
    status: "authenticated",
    accessToken: "staff-token",
    user: {
      ...user,
      permissions: [...user.permissions, "numbers.assign", "audit.view"],
    },
  });
  window.history.replaceState({}, "", "/inventory/507f1f77bcf86cd799439013");
  let assigned = false;
  const request = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/assignments") && init?.method === "POST") {
        assigned = true;
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: "assignment-1" }),
        };
      }
      const data = path.includes("/numbers/507f1f77bcf86cd799439013/history")
        ? { items: [], total: 0, pageSize: 25 }
        : path.includes("/numbers/507f1f77bcf86cd799439013")
          ? {
              e164: "+18043024183",
              status: "active",
              carrier: "mock",
              carrierAccount: "fixture",
              firstSeenAt: "2026-10-11T00:00:00Z",
              lastSeenAt: "2026-10-11T00:00:00Z",
              holdings: [],
              assignments: assigned
                ? [{ customerId: "507f1f77bcf86cd799439012", active: true }]
                : [],
            }
          : path.includes("/customers?")
            ? {
                items: [
                  {
                    id: "507f1f77bcf86cd799439012",
                    name: "Acme West",
                    status: "active",
                  },
                ],
                total: 1,
              }
            : { name: "DataPhone", purpose: "Internal DID management" };
      return { ok: true, json: async () => data };
    },
  );
  vi.stubGlobal("fetch", request);
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Assign number" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Customer" }), {
    target: { value: "507f1f77bcf86cd799439012" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm assignment" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/api/v1/assignments",
      expect.objectContaining({ method: "POST" }),
    ),
  );
  expect(await screen.findByText(/Acme West/)).toBeInTheDocument();
});

it("bulk assigns selected inventory numbers", async () => {
  useAuthStore.setState({
    status: "authenticated",
    accessToken: "staff-token",
    user: { ...user, permissions: [...user.permissions, "numbers.assign"] },
  });
  window.history.replaceState({}, "", "/inventory");
  const request = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/assignments/bulk") && init?.method === "POST")
        return { ok: true, status: 201, json: async () => [] };
      const data = path.includes("/numbers?")
        ? {
            items: [
              {
                id: "507f1f77bcf86cd799439013",
                e164: "+18043024183",
                status: "active",
                updatedAt: "2026-10-11T00:00:00Z",
              },
              {
                id: "507f1f77bcf86cd799439014",
                e164: "+18042121778",
                status: "active",
                updatedAt: "2026-10-11T00:00:00Z",
              },
            ],
            total: 2,
            pageSize: 50,
          }
        : path.includes("/customers?")
          ? {
              items: [
                {
                  id: "507f1f77bcf86cd799439012",
                  name: "Acme West",
                  status: "active",
                },
              ],
              total: 1,
            }
          : path.endsWith("/carriers")
            ? []
            : path.includes("/reconciliation/issues")
              ? []
              : { name: "DataPhone" };
      return { ok: true, json: async () => data };
    },
  );
  vi.stubGlobal("fetch", request);
  render(<App />);
  fireEvent.click(
    await screen.findByRole("checkbox", { name: "Select +18043024183" }),
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Select +18042121778" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Assign selected" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Customer" }), {
    target: { value: "507f1f77bcf86cd799439012" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm bulk assignment" }),
  );
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/api/v1/assignments/bulk",
      expect.objectContaining({ method: "POST" }),
    ),
  );
});

it("transfers and then unassigns an owned number", async () => {
  useAuthStore.setState({
    status: "authenticated",
    accessToken: "staff-token",
    user: { ...user, permissions: [...user.permissions, "numbers.assign"] },
  });
  window.history.replaceState({}, "", "/inventory/507f1f77bcf86cd799439013");
  const firstCustomer = "507f1f77bcf86cd799439012";
  const secondCustomer = "507f1f77bcf86cd799439015";
  let current: string | null = firstCustomer;
  const request = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/assignments/transfer") && init?.method === "POST") {
        current = secondCustomer;
        return { ok: true, status: 201, json: async () => ({}) };
      }
      if (path.endsWith("/assignments/unassign") && init?.method === "POST") {
        current = null;
        return { ok: true, status: 201, json: async () => ({}) };
      }
      const data = path.includes("/customers?")
        ? {
            items: [
              { id: firstCustomer, name: "First Customer", status: "active" },
              { id: secondCustomer, name: "Second Customer", status: "active" },
            ],
            total: 2,
          }
        : path.includes("/numbers/507f1f77bcf86cd799439013")
          ? {
              e164: "+18043024183",
              status: "active",
              carrier: "mock",
              firstSeenAt: "2026-10-11T00:00:00Z",
              lastSeenAt: "2026-10-11T00:00:00Z",
              holdings: [],
              assignments: current
                ? [{ customerId: current, active: true }]
                : [{ customerId: secondCustomer, active: false }],
            }
          : { name: "DataPhone" };
      return { ok: true, json: async () => data };
    },
  );
  vi.stubGlobal("fetch", request);
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Transfer number" }),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Customer" }), {
    target: { value: secondCustomer },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm transfer" }));
  expect(
    await screen.findByText(/Current customer: Second Customer/),
  ).toBeInTheDocument();
  fireEvent.click(
    await screen.findByRole("button", { name: "Unassign number" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm unassignment" }));
  expect(
    await screen.findByRole("button", { name: "Assign number" }),
  ).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith(
    "/api/v1/assignments/unassign",
    expect.objectContaining({ method: "POST" }),
  );
});
