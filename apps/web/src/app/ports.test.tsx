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
  permissions: ["ports.manage", "customers.view"],
};
const portId = "8a5de08a-1315-5fd3-8a77-4dc29c9a2b25";
const accountId = "1fe2a5c3-23da-5705-a7df-8d5cd76fea6d";
const customerId = "10bb07ef-2c43-5119-920c-da830352f069";

beforeEach(() => {
  useAuthStore.setState({
    status: "authenticated",
    accessToken: "port-token",
    user,
  });
  window.history.replaceState({}, "", "/ports");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("creates a redacted port draft through the browser wizard", async () => {
  const request = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/ports") && init?.method === "POST")
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: portId,
            status: "DRAFT",
            numbers: ["+18043024183"],
          }),
        };
      if (path.endsWith("/ports"))
        return { ok: true, json: async () => ({ items: [], total: 0 }) };
      if (path.includes("/customers?"))
        return {
          ok: true,
          json: async () => ({
            items: [{ id: customerId, name: "Acme West", status: "active" }],
          }),
        };
      if (path.endsWith("/carriers"))
        return {
          ok: true,
          json: async () => [
            {
              code: "mock",
              displayName: "Mock",
              accounts: [
                {
                  id: accountId,
                  externalAccountId: "sandbox",
                  status: "active",
                },
              ],
            },
          ],
        };
      return { ok: true, json: async () => ({ name: "DataPhone" }) };
    },
  );
  vi.stubGlobal("fetch", request);
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "New port request" }),
  );
  await screen.findByRole("option", { name: "Acme West" });
  await screen.findByRole("option", { name: "Mock · sandbox" });
  fireEvent.change(screen.getByRole("combobox", { name: "Customer" }), {
    target: { value: customerId },
  });
  fireEvent.change(
    screen.getByRole("combobox", { name: "Destination carrier account" }),
    { target: { value: accountId } },
  );
  for (const [name, value] of [
    ["Numbers to port", "+18043024183"],
    ["Current provider", "Old Carrier"],
    ["Account name", "Acme West"],
    ["Account number", "sensitive-123"],
    ["Account PIN", "7788"],
    ["Address line 1", "1 Main St"],
    ["City", "Richmond"],
    ["State", "VA"],
    ["Postal code", "23220"],
  ])
    fireEvent.change(screen.getByLabelText(name), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/api/v1/ports",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"accountNumber":"sensitive-123"'),
      }),
    ),
  );
  expect(await screen.findByText(/Draft created/)).toBeInTheDocument();
  expect(screen.queryByText("sensitive-123")).not.toBeInTheDocument();
});

it.each([
  ["DATE_CONFIRMED", true],
  ["COMPLETED", false],
])(
  "describes FOC progress correctly for a %s port",
  async (status, inProgress) => {
    window.history.replaceState({}, "", `/ports/${portId}`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        const data = path.endsWith(`/ports/${portId}`)
          ? {
              id: portId,
              status,
              numbers: ["+18043024183"],
              focDate: "2026-11-12T00:00:00.000Z",
              currentProvider: "Old Carrier",
              accountName: "Acme West",
              history: [
                {
                  id: "event-1",
                  type: "port.date_confirmed",
                  createdAt: "2026-10-11T00:00:00Z",
                },
              ],
            }
          : path.endsWith(`/ports/${portId}/documents`)
            ? []
            : { name: "DataPhone" };
        return { ok: true, json: async () => data };
      }),
    );
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "Port request" }),
    ).toBeInTheDocument();
    await screen.findByText(/11\/12\/2026/);
    expect(Boolean(screen.queryByText(/Port is still in progress/))).toBe(
      inProgress,
    );
    expect(screen.getAllByText(/Date confirmed/).length).toBeGreaterThan(0);
    expect(screen.getByText(/11\/12\/2026/)).toBeInTheDocument();
  },
);
