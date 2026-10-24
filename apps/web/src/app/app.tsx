import { DesignProvider } from "../shared/theme/theme";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Box, Skeleton, Typography } from "@mui/material";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "./layout/app-layout";
import { RequireAuth, RequirePermission } from "./require-auth";
const CustomersPage = lazy(() =>
  import("../pages/customers-page").then((module) => ({
    default: module.CustomersPage,
  })),
);
const CustomerDetailPage = lazy(() =>
  import("../pages/customer-detail-page").then((module) => ({
    default: module.CustomerDetailPage,
  })),
);
const InventoryPage = lazy(() =>
  import("../pages/inventory-page").then((module) => ({
    default: module.InventoryPage,
  })),
);
const NumberDetailPage = lazy(() =>
  import("../pages/number-detail-page").then((module) => ({
    default: module.NumberDetailPage,
  })),
);
const PurchasesPage = lazy(() =>
  import("../pages/purchases-page").then((module) => ({
    default: module.PurchasesPage,
  })),
);
const JobsPage = lazy(() =>
  import("../pages/jobs-page").then((module) => ({ default: module.JobsPage })),
);
const LoginPage = lazy(() =>
  import("../pages/login-page").then((module) => ({
    default: module.LoginPage,
  })),
);
const OverviewPage = lazy(() =>
  import("../pages/overview-page").then((module) => ({
    default: module.OverviewPage,
  })),
);
const UsersPage = lazy(() =>
  import("../pages/users-page").then((module) => ({
    default: module.UsersPage,
  })),
);
const PortsPage = lazy(() =>
  import("../pages/ports-page").then((module) => ({
    default: module.PortsPage,
  })),
);
const PortDetailPage = lazy(() =>
  import("../pages/port-detail-page").then((module) => ({
    default: module.PortDetailPage,
  })),
);
const ReportsPage = lazy(() =>
  import("../pages/reports-page").then((module) => ({
    default: module.ReportsPage,
  })),
);
import { useAuthStore } from "./model/use-auth-store";

const CarriersPage = lazy(() =>
  import("../pages/carriers-page").then((module) => ({
    default: module.CarriersPage,
  })),
);

function SessionInitializer() {
  const initialize = useAuthStore((state) => state.initialize);
  const userId = useAuthStore((state) => state.user?.id);
  const previousUser = useRef(userId);
  const client = useQueryClient();
  useEffect(() => {
    if (previousUser.current !== userId) {
      client.clear();
      previousUser.current = userId;
    }
  }, [userId, client]);
  useEffect(() => {
    void initialize();
  }, [initialize]);
  return null;
}

export function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { refetchOnWindowFocus: false } },
      }),
  );
  return (
    <DesignProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <SessionInitializer />
          <Suspense
            fallback={
              <Box sx={{ p: 4 }} role="status" aria-label="Loading page">
                <Skeleton height={45} width="40%" />
                <Skeleton height={240} variant="rounded" sx={{ mt: 3 }} />
              </Box>
            }
          >
            <Routes>
              <Route path="login" element={<LoginPage />} />
              <Route element={<RequireAuth />}>
                <Route element={<AppLayout />}>
                  <Route index element={<OverviewPage />} />
                  <Route
                    path="carriers"
                    element={
                      <RequirePermission permission="inventory.view">
                        <CarriersPage />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="*"
                    element={
                      <Typography component="h1" variant="h4">
                        Page not found
                      </Typography>
                    }
                  />
                  <Route
                    path="inventory"
                    element={
                      <RequirePermission permission="inventory.view">
                        <InventoryPage />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="inventory/:id"
                    element={
                      <RequirePermission permission="inventory.view">
                        <NumberDetailPage />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="search"
                    element={
                      <RequirePermission permission="inventory.view">
                        <PurchasesPage readOnly />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="purchases"
                    element={
                      <RequirePermission permission="numbers.purchase">
                        <PurchasesPage />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="ports"
                    element={
                      <RequirePermission permission="ports.manage">
                        <PortsPage />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="ports/:id"
                    element={
                      <RequirePermission permission="ports.manage">
                        <PortDetailPage />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="customers"
                    element={
                      <RequirePermission permission="customers.view">
                        <CustomersPage />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="customers/:id"
                    element={
                      <RequirePermission permission="customers.view">
                        <CustomerDetailPage />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="jobs"
                    element={
                      <RequirePermission permission="jobs.view">
                        <JobsPage />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="reports"
                    element={
                      <RequirePermission permission="reports.view">
                        <ReportsPage />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="reports/:type"
                    element={
                      <RequirePermission permission="reports.view">
                        <ReportsPage />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="users"
                    element={
                      <RequirePermission permission="users.manage">
                        <UsersPage />
                      </RequirePermission>
                    }
                  />
                </Route>
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </QueryClientProvider>
    </DesignProvider>
  );
}
