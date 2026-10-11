import { createTheme, ThemeProvider } from "@mui/material/styles";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "./layout/app-layout";
import { RequireAuth, RequirePermission } from "./require-auth";
import { CustomersPage } from "../pages/customers-page";
import { CustomerDetailPage } from "../pages/customer-detail-page";
import { InventoryPage } from "../pages/inventory-page";
import { NumberDetailPage } from "../pages/number-detail-page";
import { PurchasesPage } from "../pages/purchases-page";
import { JobsPage } from "../pages/jobs-page";
import { LoginPage } from "../pages/login-page";
import { OverviewPage } from "../pages/overview-page";
import { UsersPage } from "../pages/users-page";
import { PortsPage } from "../pages/ports-page";
import { PortDetailPage } from "../pages/port-detail-page";
import { useAuthStore } from "./model/use-auth-store";

function SessionInitializer() {
  const initialize = useAuthStore((state) => state.initialize);
  useEffect(() => {
    void initialize();
  }, [initialize]);
  return null;
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});
const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#145b76" },
    background: { default: "#f7f9fa" },
  },
  shape: { borderRadius: 10 },
});

export function App() {
  return (
    <ThemeProvider theme={theme}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <SessionInitializer />
          <Routes>
            <Route path="login" element={<LoginPage />} />
            <Route element={<RequireAuth />}>
              <Route element={<AppLayout />}>
                <Route index element={<OverviewPage />} />
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
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
