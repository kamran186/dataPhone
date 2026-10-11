import { createTheme, ThemeProvider } from "@mui/material/styles";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "./layout/app-layout";
import { CustomersPage } from "../pages/customers-page";
import { InventoryPage } from "../pages/inventory-page";
import { OverviewPage } from "../pages/overview-page";

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
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<OverviewPage />} />
              <Route path="inventory" element={<InventoryPage />} />
              <Route path="customers" element={<CustomersPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
