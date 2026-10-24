import { expect, test, type Page } from "@playwright/test";

// Explicit test fixtures only: these values never enter the application bundle.
const operator = {
  id: "qa-operator",
  email: "alex@dataphone.test",
  roleKeys: ["OPERATIONS_MANAGER"],
  permissions: [
    "inventory.view",
    "inventory.manage",
    "numbers.assign",
    "numbers.purchase",
    "customers.view",
    "customers.manage",
    "reports.view",
    "jobs.view",
    "ports.manage",
    "sync.trigger",
    "carriers.configure",
    "users.manage",
  ],
};
const carrier = {
  id: "carrier-1",
  code: "peerless",
  displayName: "Peerless Network",
  capabilities: ["inventory.list", "numbers.search"],
  accounts: [
    {
      id: "account-1",
      externalAccountId: "Primary account",
      status: "active",
      lastSyncedAt: "2026-10-24T09:30:00Z",
      lastSync: {
        startedAt: "2026-10-24T09:29:00Z",
        status: "succeeded",
        seen: 720,
        issues: 0,
      },
    },
  ],
};
const numbers = [
  {
    id: "number-1",
    e164: "+16465550100",
    status: "active",
    carrier: "peerless",
    customerName: "Acme Communications",
    updatedAt: "2026-10-24T09:30:00Z",
  },
  {
    id: "number-2",
    e164: "+16465550101",
    status: "active",
    carrier: "bandwidth",
    updatedAt: "2026-10-24T09:25:00Z",
  },
  {
    id: "number-3",
    e164: "+18045550100",
    status: "missing",
    carrier: "bulkvs",
    updatedAt: "2026-10-23T11:30:00Z",
  },
];
async function mockApi(
  page: Page,
  permissions = operator.permissions,
  anonymous = false,
) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown = { name: "DataPhone" };
    if (path.endsWith("/auth/refresh")) {
      if (anonymous) {
        await route.fulfill({ status: 401, json: { message: "No session" } });
        return;
      }
      body = { accessToken: "qa-token", user: { ...operator, permissions } };
    } else if (path.endsWith("/dashboard"))
      body = {
        totalDids: 1248,
        activeDids: 1196,
        assigned: 1024,
        potentiallyUnused: 172,
        openPorts: 12,
        pendingPurchases: 3,
        failedJobs: 2,
        byCarrier: [
          { carrier: "peerless", count: 720 },
          { carrier: "bandwidth", count: 368 },
          { carrier: "bulkvs", count: 160 },
        ],
        carrierSync: [
          {
            carrier: "peerless",
            account: "Primary account",
            status: "succeeded",
            lastSyncedAt: "2026-10-24T09:30:00Z",
          },
          {
            carrier: "bandwidth",
            account: "East coast",
            status: "succeeded",
            lastSyncedAt: "2026-10-24T09:20:00Z",
          },
          { carrier: "bulkvs", account: "Main account", status: "failed" },
        ],
      };
    else if (path.endsWith("/carriers")) body = [carrier];
    else if (path.endsWith("/reconciliation/issues")) body = [];
    else if (path.endsWith("/numbers"))
      body = {
        items: numbers.filter(
          (item) =>
            !url.searchParams.get("search") ||
            item.e164.includes(url.searchParams.get("search")!),
        ),
        total: numbers.length,
        pageSize: 50,
      };
    else if (path.includes("/numbers/"))
      body = {
        ...numbers[0],
        carrierAccount: "Primary account",
        firstSeenAt: "2026-10-01T10:00:00Z",
        lastSeenAt: "2026-10-24T09:30:00Z",
        assignments: [],
        holdings: [],
      };
    else if (path.endsWith("/customers"))
      body = {
        items: [
          {
            id: "customer-1",
            name: "Acme Communications",
            externalId: "ACME-001",
            status: "active",
            version: 1,
          },
        ],
        total: 1,
        pageSize: 25,
      };
    else if (path.endsWith("/jobs"))
      body = {
        items: [
          {
            id: "job-1",
            type: "inventory.sync",
            status: "running",
            progress: 64,
            attempts: 1,
            maxAttempts: 3,
            createdAt: "2026-10-24T09:30:00Z",
          },
          {
            id: "job-2",
            type: "port.submit",
            status: "succeeded",
            progress: 100,
            attempts: 1,
            maxAttempts: 3,
            createdAt: "2026-10-24T08:20:00Z",
          },
        ],
      };
    else if (path.endsWith("/ports"))
      body = {
        items: [
          {
            id: "port-1",
            numbers: ["+18045550120"],
            currentProvider: "Peerless",
            status: "SUBMITTED",
          },
        ],
        total: 1,
      };
    else if (path.endsWith("/purchases")) body = { items: [], total: 0 };
    else if (path.endsWith("/users")) body = [{ ...operator, active: true }];
    else if (path.includes("/reports/"))
      body = {
        columns: ["Number", "Customer", "Status"],
        rows: [
          {
            Number: numbers[0].e164,
            Customer: "Acme Communications",
            Status: "active",
          },
        ],
        total: 1,
        pageSize: 50,
      };
    await route.fulfill({ json: body });
  });
}

test("appearance follows the OS, keeps System selected, and persists explicit choices", async ({
  page,
}) => {
  await mockApi(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-dp-theme", "dark");
  await expect(
    page.getByRole("button", { name: "Theme: System" }),
  ).toBeVisible();
  const darkCanvas = await page
    .locator("body")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-dp-theme", "light");
  await expect
    .poll(() =>
      page
        .locator("body")
        .evaluate((node) => getComputedStyle(node).backgroundColor),
    )
    .not.toBe(darkCanvas);
  await page.getByRole("button", { name: "Theme: System" }).click();
  await page.getByRole("menuitem", { name: /Dark/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-dp-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-dp-theme", "dark");
  expect(
    await page.evaluate(() => localStorage.getItem("dataphone-theme")),
  ).toBe("dark");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-dp-theme", "dark");
  await page.getByRole("button", { name: "Theme: Dark" }).click();
  await page.getByRole("menuitem", { name: /System/ }).click();
  expect(
    await page.evaluate(() => localStorage.getItem("dataphone-theme")),
  ).toBe("system");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-dp-theme", "dark");
  expect(
    await page.evaluate(() => localStorage.getItem("dataphone-theme")),
  ).toBe("system");
  await page.screenshot({
    path: "/tmp/dataphone-dashboard-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-dp-theme", "light");
  await page.screenshot({
    path: "/tmp/dataphone-dashboard-light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Theme: System" }).click();
  await page.getByRole("menuitem", { name: /Light/ }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-dp-theme", "light");
  expect(
    await page.evaluate(() => localStorage.getItem("dataphone-theme")),
  ).toBe("light");
});

test("command search respects permissions and supports keyboard navigation", async ({
  page,
}) => {
  await mockApi(page, ["inventory.view"]);
  await page.goto("/");
  await page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
  await page.keyboard.press("Control+k");
  const search = page.getByRole("combobox", { name: "Search destinations" });
  await expect(search).toBeFocused();
  await expect(page.getByRole("option", { name: /Team & access/ })).toHaveCount(
    0,
  );
  await search.fill("inventory");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/inventory$/);
  await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
  await page.goto("/users");
  await expect(
    page.getByText("You do not have access to this page."),
  ).toBeVisible();
});

test("inventory density, columns, server search, and detail preview work", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/inventory");
  await page.getByRole("link", { name: "+16465550100", exact: true }).waitFor();
  await page.getByRole("button", { name: "Compact", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Compact", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Columns", exact: true }).click();
  await page.getByRole("menuitem", { name: /Updated/ }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("columnheader", { name: "Updated", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Preview +16465550100" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Recorded", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Close number details" }).click();
  const response = page.waitForRequest(
    (request) =>
      request.url().includes("/numbers?") &&
      request.url().includes("search=0100"),
  );
  await page.getByLabel("Number contains").fill("0100");
  await response;
  await expect(
    page.getByRole("link", { name: "+16465550101", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Reset filters" }).click();
  await expect(page.getByLabel("Number contains")).toHaveValue("");
  await expect(
    page.getByRole("link", { name: "+16465550101", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await page.screenshot({
    path: "/tmp/dataphone-inventory.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("login validates fields and respects reduced motion", async ({ page }) => {
  await mockApi(page, [], true);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Enter your work email.")).toBeVisible();
  await expect(page.getByText("Enter your password.")).toBeVisible();
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page.locator('input[name="password"]')).toHaveAttribute(
    "type",
    "text",
  );
  expect(
    await page
      .locator(".globe-route")
      .evaluate((node) => getComputedStyle(node).animationName),
  ).toBe("none");
  await expect(page.locator("video")).toHaveCount(0);
  await page.screenshot({
    path: "/tmp/dataphone-login-dark.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("mobile routes keep controls usable and constrain tables", async ({
  page,
}) => {
  await mockApi(page);
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of [
    "/",
    "/inventory",
    "/customers",
    "/carriers",
    "/search",
    "/purchases",
    "/ports",
    "/jobs",
    "/reports",
    "/users",
  ]) {
    await page.goto(route);
    await page.locator("h1").waitFor();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  expect(runtimeErrors).toEqual([]);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "DID inventory", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeHidden();
  await page.screenshot({ path: "/tmp/dataphone-mobile.png", fullPage: true });
});

test("job monitor resumes after a dropped stream and presents persisted completion", async ({
  page,
}) => {
  await mockApi(page);
  let requests = 0;
  await page.route("**/jobs/job-1/events", async (route) => {
    requests += 1;
    if (requests === 1) {
      await route.abort();
      return;
    }
    await route.fulfill({
      contentType: "text/event-stream",
      body: `id: 1\nevent: succeeded\ndata: ${JSON.stringify({ jobId: "job-1", type: "succeeded", progress: 100, message: "Inventory synchronization completed", createdAt: "2026-10-24T09:35:00Z" })}\n\n`,
    });
  });
  await page.goto("/jobs");
  await page.getByRole("button", { name: /inventory.sync/ }).click();
  await expect(page.getByText(/Reconnecting/)).toBeVisible();
  await expect(
    page.getByText("Processing completed successfully."),
  ).toBeVisible();
  await expect(
    page.getByText("Inventory synchronization completed"),
  ).toBeVisible();
  await expect(page.getByText("Event stream complete")).toBeVisible();
  expect(requests).toBe(2);
  await page.screenshot({ path: "/tmp/dataphone-jobs.png", fullPage: true });
});

test("stored dark appearance is resolved before the application module loads", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() =>
    localStorage.setItem("dataphone-theme", "dark"),
  );
  await page.route("**/src/main.tsx", (route) => route.abort());
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-dp-theme", "dark");
  expect(
    await page
      .locator("html")
      .evaluate((node) => getComputedStyle(node).backgroundColor),
  ).toBe("rgb(8, 15, 30)");
});

test("appearance switching still works when browser storage is unavailable", async ({
  page,
}) => {
  await mockApi(page, [], true);
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("Storage disabled");
    };
    Storage.prototype.setItem = () => {
      throw new Error("Storage disabled");
    };
  });
  await page.goto("/login");
  await page.getByRole("button", { name: "Theme: System" }).click();
  await page.getByRole("menuitem", { name: /Dark/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-dp-theme", "dark");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("operational routes and dialogs use dark surfaces without runtime errors", async ({
  page,
}) => {
  await mockApi(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() =>
    localStorage.setItem("dataphone-theme", "dark"),
  );
  for (const route of [
    "/",
    "/inventory",
    "/customers",
    "/carriers",
    "/search",
    "/purchases",
    "/ports",
    "/jobs",
    "/reports",
    "/users",
  ]) {
    await page.goto(route);
    await page.locator("h1").waitFor();
    await expect(page.locator("html")).toHaveAttribute("data-dp-theme", "dark");
    await expect
      .poll(() =>
        page
          .locator("body")
          .evaluate((node) => getComputedStyle(node).backgroundColor),
      )
      .toBe("rgb(8, 15, 30)");
  }
  await page.goto("/customers");
  await page.getByRole("button", { name: "Add customer" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate((node) => getComputedStyle(node).backgroundColor),
  ).toBe("rgb(16, 27, 45)");
  expect(errors).toEqual([]);
});
