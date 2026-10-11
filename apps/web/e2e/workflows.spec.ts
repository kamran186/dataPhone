import { expect, test } from "@playwright/test";

const user = {
  id: "507f1f77bcf86cd799439011",
  email: "operator@example.test",
  roleKeys: ["SUPER_ADMIN"],
  permissions: [
    "inventory.view",
    "customers.view",
    "ports.manage",
    "reports.view",
    "jobs.view",
  ],
};
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const body = path.endsWith("/auth/refresh")
      ? { accessToken: "browser-token", user }
      : path.endsWith("/dashboard")
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
        : path.endsWith("/ports") && method === "POST"
          ? {
              id: "507f1f77bcf86cd799439099",
              status: "DRAFT",
              numbers: ["+18043024183"],
            }
          : path.endsWith("/ports")
            ? { items: [], total: 0 }
            : path.endsWith("/carriers")
              ? [
                  {
                    code: "mock",
                    displayName: "Mock",
                    accounts: [
                      {
                        id: "507f1f77bcf86cd799439021",
                        externalAccountId: "sandbox",
                        status: "active",
                      },
                    ],
                  },
                ]
              : path.endsWith("/customers")
                ? {
                    items: [
                      {
                        id: "507f1f77bcf86cd799439012",
                        name: "Acme West",
                        status: "active",
                      },
                    ],
                  }
                : path.includes("/reports/")
                  ? {
                      type: "all-dids",
                      columns: ["Number", "Status"],
                      rows: [{ Number: "+18043024184", Status: "active" }],
                      total: 1,
                      page: 1,
                      pageSize: 50,
                    }
                  : { name: "DataPhone" };
    await route.fulfill({
      status: path.endsWith("/ports") && method === "POST" ? 201 : 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
});

test("dashboard and reports are navigable in Chrome", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(
    page.getByText("Potentially unused", { exact: true }),
  ).toBeVisible();
  await page.goto("/reports/all-dids");
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await expect(page.getByText("+18043024184")).toBeVisible();
});

test("port wizard submits a draft and removes secrets from the screen", async ({
  page,
}) => {
  await page.goto("/ports");
  await page.getByRole("button", { name: "New port request" }).click();
  await page
    .getByLabel("Customer", { exact: true })
    .selectOption("507f1f77bcf86cd799439012");
  await page
    .getByLabel("Destination carrier account")
    .selectOption("507f1f77bcf86cd799439021");
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
    await page.getByLabel(name, { exact: true }).fill(value);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText(/Draft created/)).toBeVisible();
  await expect(page.getByText("sensitive-123")).toHaveCount(0);
});
