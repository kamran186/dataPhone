import {
  AppBar,
  Box,
  Button,
  Chip,
  Container,
  CssBaseline,
  Drawer,
  Stack,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { NavLink, Outlet } from "react-router-dom";
import { useSystemInfo } from "../../entities/system/api/use-system-info";
import { useAuthStore } from "../model/use-auth-store";
import { useShellStore } from "../model/use-shell-store";

const drawerWidth = 232;
const links = [
  { to: "/", label: "Overview", permission: null },
  { to: "/inventory", label: "Inventory", permission: "inventory.view" },
  { to: "/customers", label: "Customers", permission: "customers.view" },
  { to: "/users", label: "Users", permission: "users.manage" },
];

function Navigation() {
  const closeMenu = useShellStore((state) => state.closeMenu);
  const user = useAuthStore((state) => state.user);
  return (
    <Stack
      component="nav"
      aria-label="Main navigation"
      spacing={0.5}
      sx={{ p: 2 }}
    >
      {links
        .filter(
          ({ permission }) =>
            !permission || user?.permissions.includes(permission),
        )
        .map(({ to, label }) => (
          <Button
            key={to}
            component={NavLink}
            to={to}
            onClick={closeMenu}
            sx={{
              justifyContent: "flex-start",
              textTransform: "none",
              color: "text.primary",
              "&.active": {
                bgcolor: "primary.light",
                color: "primary.dark",
                fontWeight: 700,
              },
            }}
          >
            {label}
          </Button>
        ))}
    </Stack>
  );
}

export function AppLayout() {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const menuOpen = useShellStore((state) => state.menuOpen);
  const toggleMenu = useShellStore((state) => state.toggleMenu);
  const system = useSystemInfo();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  return (
    <Box
      sx={{
        display: "flex",
        minHeight: "100vh",
        bgcolor: "background.default",
      }}
    >
      <CssBaseline />
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          zIndex: theme.zIndex.drawer + 1,
          bgcolor: "background.paper",
          color: "text.primary",
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Toolbar sx={{ gap: 2 }}>
          {!isDesktop && (
            <Button aria-label="Open navigation" onClick={toggleMenu}>
              Menu
            </Button>
          )}
          <Typography
            variant="h6"
            component="div"
            sx={{ fontWeight: 800, flexGrow: 1 }}
          >
            DataPhone
          </Typography>
          <Chip
            size="small"
            color={
              system.isSuccess
                ? "success"
                : system.isPending
                  ? "default"
                  : "error"
            }
            label={
              system.isSuccess
                ? "Connected"
                : system.isPending
                  ? "Checking"
                  : "API unavailable"
            }
          />
          <Typography
            variant="body2"
            sx={{ display: { xs: "none", sm: "block" } }}
          >
            {user?.email}
          </Typography>
          <Button onClick={() => void logout()} size="small">
            Sign out
          </Button>
        </Toolbar>
      </AppBar>
      <Drawer
        variant={isDesktop ? "permanent" : "temporary"}
        open={isDesktop || menuOpen}
        onClose={toggleMenu}
        sx={{
          width: isDesktop ? drawerWidth : 0,
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: drawerWidth,
            boxSizing: "border-box",
            pt: 8,
          },
        }}
      >
        <Navigation />
      </Drawer>
      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, pt: 12, pb: 6 }}>
        <Container maxWidth="lg">
          <Outlet />
        </Container>
      </Box>
    </Box>
  );
}
