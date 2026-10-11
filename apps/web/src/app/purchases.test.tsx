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
  email: "operator@example.test",
  roleKeys: ["SUPER_ADMIN"],
  permissions: [
    "numbers.purchase",
    "numbers.disconnect",
    "inventory.view",
    "customers.view",
    "jobs.view",
  ],
};

beforeEach(() => {
  window.history.replaceState({}, "", "/purchases");
  useAuthStore.setState({
    status: "authenticated",
    accessToken: "operator-token",
    user,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("searches offers, compares prices, and creates a multi-number customer order", async () => {
  const request = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/purchases") && init?.method === "POST")
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: "507f1f77bcf86cd799439099",
            status: "queued",
            jobId: "507f1f77bcf86cd799439098",
          }),
        };
      if (path.includes("/purchases/search?"))
        return {
          ok: true,
          json: async () => ({
            offers: [
              {
                e164: "+18043024183",
                nativeId: "mock-1",
                carrier: "mock",
                carrierName: "Mock",
                carrierAccountId: "507f1f77bcf86cd799439021",
                monthlyPriceCents: 125,
                currency: "USD",
              },
              {
                e164: "+18043024184",
                nativeId: "mock-2",
                carrier: "mock",
                carrierName: "Mock",
                carrierAccountId: "507f1f77bcf86cd799439021",
                monthlyPriceCents: 150,
                currency: "USD",
              },
            ],
            errors: [],
          }),
        };
      if (path.includes("/customers?"))
        return {
          ok: true,
          json: async () => ({
            items: [
              {
                id: "507f1f77bcf86cd799439012",
                name: "Acme West",
                status: "active",
              },
            ],
          }),
        };
      if (path.endsWith("/purchases"))
        return { ok: true, json: async () => ({ items: [], total: 0 }) };
      if (path.endsWith("/auth/refresh")) return { ok: false, status: 401 };
      return { ok: true, json: async () => ({ name: "DataPhone" }) };
    },
  );
  vi.stubGlobal("fetch", request);
  render(<App />);
  fireEvent.change(await screen.findByRole("textbox", { name: "Area code" }), {
    target: { value: "804" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Search available numbers" }),
  );
  expect(await screen.findByText("$1.25/mo")).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Select +18043024183" }),
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Select +18043024184" }),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Customer" }), {
    target: { value: "507f1f77bcf86cd799439012" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Create purchase order" }),
  );
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/api/v1/purchases",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"nativeIds":["mock-1","mock-2"]'),
      }),
    ),
  );
  expect(await screen.findByText(/Order queued/)).toBeInTheDocument();
});

it("requires the exact number before submitting a disconnect request", async () => {
  window.history.replaceState({}, "", "/inventory/507f1f77bcf86cd799439013");
  const request = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/disconnect") && init?.method === "POST")
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: "507f1f77bcf86cd799439095",
            status: "queued",
            jobId: "507f1f77bcf86cd799439096",
          }),
        };
      if (path.includes("/numbers/507f1f77bcf86cd799439013"))
        return {
          ok: true,
          json: async () => ({
            e164: "+18043024183",
            status: "active",
            carrier: "mock",
            carrierAccount: "sandbox-a",
            firstSeenAt: "2026-10-11T00:00:00Z",
            lastSeenAt: "2026-10-11T00:00:00Z",
            holdings: [],
            assignments: [],
          }),
        };
      if (path.includes("/customers?"))
        return { ok: true, json: async () => ({ items: [] }) };
      return { ok: true, json: async () => ({ name: "DataPhone" }) };
    },
  );
  vi.stubGlobal("fetch", request);
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Disconnect number" }),
  );
  expect(
    screen.getByRole("button", { name: "Confirm disconnect" }),
  ).toBeDisabled();
  fireEvent.change(
    screen.getByRole("textbox", { name: "Type number to confirm" }),
    {
      target: { value: "+18043024183" },
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm disconnect" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/api/v1/numbers/507f1f77bcf86cd799439013/disconnect",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"confirmE164":"+18043024183"'),
      }),
    ),
  );
  expect(await screen.findByText(/Disconnect queued/)).toBeInTheDocument();
});
