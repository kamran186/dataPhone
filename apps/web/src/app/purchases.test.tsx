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
  id: "ac902665-6c90-55b4-b4ab-36c1e3d87cd8",
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
            id: "8a5de08a-1315-5fd3-8a77-4dc29c9a2b25",
            status: "queued",
            jobId: "7e7e350f-c0eb-5a69-b327-712884b66a50",
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
                carrierAccountId: "1fe2a5c3-23da-5705-a7df-8d5cd76fea6d",
                monthlyPriceCents: 125,
                currency: "USD",
              },
              {
                e164: "+18043024184",
                nativeId: "mock-2",
                carrier: "mock",
                carrierName: "Mock",
                carrierAccountId: "1fe2a5c3-23da-5705-a7df-8d5cd76fea6d",
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
                id: "10bb07ef-2c43-5119-920c-da830352f069",
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
    target: { value: "10bb07ef-2c43-5119-920c-da830352f069" },
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
  window.history.replaceState(
    {},
    "",
    "/inventory/b7968cbe-a0ae-56bf-a4b9-7991e5ed6ad1",
  );
  const request = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/disconnect") && init?.method === "POST")
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: "234265d9-214c-561e-a7f3-d447f5dc050a",
            status: "queued",
            jobId: "4d3a9f15-7d3a-5892-ba42-b650479615f4",
          }),
        };
      if (path.includes("/numbers/b7968cbe-a0ae-56bf-a4b9-7991e5ed6ad1"))
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
      "/api/v1/numbers/b7968cbe-a0ae-56bf-a4b9-7991e5ed6ad1/disconnect",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"confirmE164":"+18043024183"'),
      }),
    ),
  );
  expect(await screen.findByText(/Disconnect queued/)).toBeInTheDocument();
});

it("lets an inventory viewer search without loading purchase data or showing order controls", async () => {
  window.history.replaceState({}, "", "/search");
  useAuthStore.setState({
    status: "authenticated",
    accessToken: "viewer-token",
    user: { ...user, roleKeys: ["VIEWER"], permissions: ["inventory.view"] },
  });
  const request = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.includes("/purchases/search?"))
      return {
        ok: true,
        json: async () => ({
          offers: [
            {
              e164: "+16465550100",
              nativeId: "16465550100",
              carrier: "bandwidth",
              carrierName: "Bandwidth",
              carrierAccountId: "account",
            },
          ],
          errors: [{ carrier: "bulkvs", code: "unsupported" }],
          outcomes: [
            {
              carrier: "peerless",
              carrierAccountId: "peerless-account",
              status: "partial",
            },
          ],
        }),
      };
    return { ok: true, json: async () => ({ name: "DataPhone" }) };
  });
  vi.stubGlobal("fetch", request);
  render(<App />);
  fireEvent.change(await screen.findByRole("textbox", { name: "Area code" }), {
    target: { value: "646" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Search available numbers" }),
  );
  expect(await screen.findByText("+16465550100")).toBeInTheDocument();
  expect(
    screen.getByText(/These search filters are not supported/),
  ).toBeInTheDocument();
  expect(screen.getByText(/showing a limited search/)).toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.queryByText("Recent orders")).not.toBeInTheDocument();
  expect(
    request.mock.calls.some(
      ([path]) =>
        String(path).includes("/customers") ||
        String(path).endsWith("/purchases"),
    ),
  ).toBe(false);
});
