import { createTheme, ThemeProvider } from "@mui/material/styles";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "./layout/app-layout";
import { RequireAuth, RequirePermission } from "./require-auth";
import { CustomersPage } from "../pages/customers-page";
import { InventoryPage } from "../pages/inventory-page";
import { LoginPage } from "../pages/login-page";
import { OverviewPage } from "../pages/overview-page";
import { UsersPage } from "../pages/users-page";
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
                  path="customers"
                  element={
                    <RequirePermission permission="customers.view">
                      <CustomersPage />
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
