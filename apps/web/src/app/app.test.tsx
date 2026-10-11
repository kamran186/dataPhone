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

const user = {
  id: "507f1f77bcf86cd799439011",
  email: "admin@example.test",
  roleKeys: ["SUPER_ADMIN"],
  permissions: ["users.manage", "inventory.view", "customers.view"],
};

beforeEach(() => {
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
