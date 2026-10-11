import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./app";
import { useAuthStore } from "./model/use-auth-store";
import { useShellStore } from "./model/use-shell-store";

const user = {
  id: "507f1f77bcf86cd799439011",
  email: "viewer@example.test",
  roleKeys: ["VIEWER"],
  permissions: ["reports.view", "inventory.view"],
};
beforeEach(() => {
  useShellStore.setState({ menuOpen: false });
  useAuthStore.setState({
    status: "authenticated",
    accessToken: "report-token",
    user,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      const data = path.endsWith("/dashboard")
        ? {
            totalDids: 2,
            activeDids: 2,
            assigned: 1,
            potentiallyUnused: 1,
            openPorts: 1,
            pendingPurchases: 0,
            failedJobs: 0,
            byCarrier: [{ carrier: "mock", count: 2 }],
            carrierSync: [],
          }
        : path.includes("/reports/")
          ? {
              type: "unassigned",
              columns: ["Number", "Status"],
              rows: [{ Number: "+18043024184", Status: "active" }],
              total: 1,
              page: 1,
              pageSize: 50,
            }
          : { name: "DataPhone" };
      return { ok: true, json: async () => data };
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows verified dashboard counts and the usage caveat", async () => {
  window.history.replaceState({}, "", "/");
  render(<App />);
  expect(await screen.findByText("Potentially unused")).toBeInTheDocument();
  expect(
    screen.getByText(/Billing and routing usage are outside this POC/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
  expect(screen.getByRole("link", { name: "Reports" })).toBeInTheDocument();
});
it("searches a report and shows its rows", async () => {
  window.history.replaceState({}, "", "/reports/unassigned");
  render(<App />);
  expect(await screen.findByText("+18043024184")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Search report" }), {
    target: { value: "4184" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(vi.mocked(fetch)).toHaveBeenCalledWith(
    expect.stringContaining("search=4184"),
    expect.anything(),
  );
});
it("hides reports from a role without permission", async () => {
  useAuthStore.setState({ user: { ...user, permissions: ["inventory.view"] } });
  window.history.replaceState({}, "", "/reports");
  render(<App />);
  expect(
    await screen.findByText("You do not have access to this page."),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Reports" }),
  ).not.toBeInTheDocument();
});
