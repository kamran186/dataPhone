import {
  Avatar,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  Link as MuiLink,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useSystemInfo } from "../../entities/system/api/use-system-info";
import { Brand } from "../../shared/ui/brand";
import { Icon } from "../../shared/ui/icon";
import { ModuleBackground } from "../../shared/ui/module-background";
import { ThemeSelector } from "../../shared/ui/theme-selector";
import { useAuthStore } from "../model/use-auth-store";
import { useShellStore } from "../model/use-shell-store";
import { destinationForPath, destinations } from "../model/navigation";
import { CommandPalette } from "./command-palette";

export function AppLayout() {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const menuOpen = useShellStore((state) => state.menuOpen);
  const toggleMenu = useShellStore((state) => state.toggleMenu);
  const closeMenu = useShellStore((state) => state.closeMenu);
  const [collapsed, setCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [userAnchor, setUserAnchor] = useState<HTMLElement | null>(null);
  const system = useSystemInfo();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const { pathname } = useLocation();
  const current = destinationForPath(pathname);
  const slim = collapsed && isDesktop;
  const width = slim ? 80 : 240;
  const name = user?.email.split("@")[0] ?? "Operator";
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);
  const navigation = (
    <Stack sx={{ height: "100%", px: slim ? 1.5 : 2, py: 3 }}>
      <Box sx={{ pl: slim ? 0.4 : 1, mb: 4 }}>
        <Brand compact={slim} />
      </Box>
      {!slim && (
        <Box
          sx={{
            mx: 0.5,
            mb: 3,
            p: 1.25,
            bgcolor: "var(--dp-raised)",
            borderRadius: 2,
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          <Avatar
            variant="rounded"
            sx={{
              width: 27,
              height: 27,
              bgcolor: "background.paper",
              color: "primary.main",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            DP
          </Avatar>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontSize: 11, fontWeight: 650 }}>
              DataPhone workspace
            </Typography>
            <Typography color="text.secondary" sx={{ fontSize: 10 }}>
              Telecommunications
            </Typography>
          </Box>
          <Icon name="lock" sx={{ fontSize: 12, color: "text.secondary" }} />
        </Box>
      )}
      <Box component="nav" aria-label="Main navigation" sx={{ flex: 1 }}>
        {(["Workspace", "Operations", "Administration"] as const).map(
          (group) => {
            const visible = destinations.filter(
              (item) =>
                item.group === group &&
                (!item.permission ||
                  user?.permissions.includes(item.permission)),
            );
            return (
              visible.length > 0 && (
                <Box key={group} sx={{ mb: 2.5 }}>
                  {!slim && (
                    <Typography
                      sx={{
                        px: 1.5,
                        mb: 1,
                        fontSize: 9,
                        fontWeight: 650,
                        letterSpacing: ".12em",
                        textTransform: "uppercase",
                        color: "text.secondary",
                      }}
                    >
                      {group}
                    </Typography>
                  )}
                  {visible.map((item) => (
                    <Tooltip
                      key={item.to}
                      title={slim ? item.label : ""}
                      placement="right"
                    >
                      <Button
                        component={NavLink}
                        end={item.to === "/"}
                        to={item.to}
                        onClick={closeMenu}
                        color="inherit"
                        sx={{
                          width: "100%",
                          minWidth: 0,
                          justifyContent: slim ? "center" : "flex-start",
                          gap: 1.5,
                          px: 1.5,
                          mb: 0.4,
                          minHeight: 40,
                          color: "text.secondary",
                          fontSize: 12,
                          position: "relative",
                          "&.active": {
                            bgcolor: "var(--dp-glow)",
                            color: "primary.main",
                            "&:before": {
                              content: "''",
                              position: "absolute",
                              left: -16,
                              top: 10,
                              bottom: 10,
                              width: 3,
                              borderRadius: 3,
                              bgcolor: "primary.main",
                            },
                          },
                        }}
                      >
                        <Icon name={item.icon} sx={{ fontSize: 18 }} />
                        {!slim && item.label}
                      </Button>
                    </Tooltip>
                  ))}
                </Box>
              )
            );
          },
        )}
      </Box>
      {!slim && (
        <Box
          sx={{
            p: 1.5,
            mt: 2,
            mb: 2,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 2,
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", mb: 0.75 }}
          >
            <Icon name="shield" sx={{ fontSize: 15, color: "primary.main" }} />
            <Typography sx={{ fontSize: 11, fontWeight: 650 }}>
              Built for connection
            </Typography>
          </Stack>
          <Typography color="text.secondary" sx={{ fontSize: 10 }}>
            One workspace. Every number.
            <br />A clearer view of your network.
          </Typography>
        </Box>
      )}
      <Divider sx={{ mb: 2 }} />
      <Stack
        direction="row"
        sx={{
          alignItems: "center",
          justifyContent: slim ? "center" : "space-between",
        }}
      >
        {!slim && (
          <Typography color="text.secondary" sx={{ fontSize: 10 }}>
            DATAPHONE / WORKSPACE
          </Typography>
        )}
        {isDesktop && (
          <Tooltip title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            <IconButton
              size="small"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={() => setCollapsed((value) => !value)}
            >
              <Icon
                name="collapse"
                sx={{
                  fontSize: 17,
                  transform: collapsed ? "rotate(180deg)" : "none",
                }}
              />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
    </Stack>
  );
  return (
    <Box sx={{ minHeight: "100vh", display: "flex" }}>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <Drawer
        variant={isDesktop ? "permanent" : "temporary"}
        open={isDesktop || menuOpen}
        onClose={closeMenu}
        sx={{
          width: isDesktop ? width : 0,
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width,
            boxSizing: "border-box",
            borderRadius: 0,
            boxShadow: "none",
            borderWidth: "0 1px 0 0",
            transition: "width 200ms",
            overflowX: "hidden",
          },
        }}
      >
        {navigation}
      </Drawer>
      <Box sx={{ flex: 1, minWidth: 0, position: "relative" }}>
        <Box
          component="header"
          className="app-header"
          sx={{
            height: 72,
            px: { xs: 2, md: 4 },
            display: "flex",
            alignItems: "center",
            gap: { xs: 0.5, sm: 2 },
            borderBottom: "1px solid",
            borderColor: "divider",
            bgcolor: "background.paper",
            position: "sticky",
            top: 0,
            zIndex: 1100,
          }}
        >
          {!isDesktop && (
            <IconButton aria-label="Open navigation" onClick={toggleMenu}>
              <Icon name="menu" fontSize="small" />
            </IconButton>
          )}
          <Breadcrumbs
            aria-label="Breadcrumb"
            separator={<Icon name="chevron" sx={{ fontSize: 12 }} />}
            sx={{ flexGrow: 1, "& .MuiBreadcrumbs-ol": { flexWrap: "nowrap" } }}
          >
            <MuiLink
              component={Link}
              to="/"
              underline="none"
              color="text.secondary"
              sx={{ fontSize: 12, display: { xs: "none", sm: "inline" } }}
            >
              Workspace
            </MuiLink>
            <Typography sx={{ fontSize: 12, fontWeight: 600 }}>
              {current.label}
            </Typography>
          </Breadcrumbs>
          <Button
            aria-label="Open command palette"
            onClick={() => setCommandOpen(true)}
            color="inherit"
            sx={{
              gap: 1,
              color: "text.secondary",
              border: { sm: "1px solid var(--dp-line)" },
              px: 1.5,
              minWidth: 36,
            }}
          >
            <Icon name="search" sx={{ fontSize: 16 }} />
            <Box
              component="span"
              sx={{
                display: { xs: "none", lg: "inline" },
                fontWeight: 400,
                mr: 4,
              }}
            >
              Search anything…
            </Box>
            <Box
              component="kbd"
              sx={{
                display: { xs: "none", sm: "inline" },
                fontSize: 10,
                bgcolor: "var(--dp-raised)",
                px: 0.6,
                py: 0.2,
                borderRadius: 0.5,
              }}
            >
              ⌘ K
            </Box>
          </Button>
          <Box
            sx={{
              width: "1px",
              flexShrink: 0,
              height: 20,
              bgcolor: "divider",
              maxWidth: "1px",
              display: { xs: "none", sm: "block" },
            }}
          />
          <ThemeSelector />
          <Tooltip title={user?.email}>
            <IconButton
              aria-label="Open user menu"
              onClick={(event) => setUserAnchor(event.currentTarget)}
              aria-haspopup="menu"
              aria-expanded={Boolean(userAnchor)}
            >
              <Avatar
                sx={{
                  width: 30,
                  height: 30,
                  bgcolor: "var(--dp-glow)",
                  color: "primary.main",
                  fontWeight: 650,
                  fontSize: 11,
                }}
              >
                {name.slice(0, 2).toUpperCase()}
              </Avatar>
            </IconButton>
          </Tooltip>
          <Menu
            anchorEl={userAnchor}
            open={Boolean(userAnchor)}
            onClose={() => setUserAnchor(null)}
          >
            <Box sx={{ px: 2, py: 1.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {user?.email}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {user?.roleKeys.join(", ").replaceAll("_", " ")}
              </Typography>
            </Box>
            <Divider />
            <MenuItem
              onClick={() => {
                setUserAnchor(null);
                void logout();
              }}
              sx={{ gap: 1 }}
            >
              <Icon name="logout" fontSize="small" />
              Sign out
            </MenuItem>
          </Menu>
        </Box>
        <Box
          component="main"
          id="main-content"
          tabIndex={-1}
          sx={{
            position: "relative",
            minHeight: "calc(100vh - 72px)",
            outline: "none",
            overflow: "clip",
          }}
        >
          <ModuleBackground
            module={
              pathname.startsWith("/inventory/") ? "movement" : current.module
            }
            animated={false}
          />
          <Box
            sx={{
              position: "relative",
              maxWidth: 1560,
              mx: "auto",
              px: { xs: 2, sm: 3, lg: 4 },
              pt: 3.5,
              pb: 5,
            }}
          >
            <Box key={pathname} className="page-enter">
              <Outlet />
            </Box>
            <Stack
              component="footer"
              direction="row"
              sx={{
                alignItems: "center",
                justifyContent: "space-between",
                pt: 4,
                mt: 4,
                borderTop: "1px solid",
                borderColor: "divider",
                gap: 1,
              }}
            >
              <Typography color="text.secondary" sx={{ fontSize: 10 }}>
                DataPhone · Intelligent connections.
              </Typography>
              <Chip
                size="small"
                variant="outlined"
                icon={
                  <Box
                    component="span"
                    sx={{
                      width: 5,
                      height: 5,
                      ml: "9px !important",
                      borderRadius: "50%",
                      bgcolor: system.isSuccess
                        ? "success.main"
                        : system.isPending
                          ? "text.secondary"
                          : "error.main",
                    }}
                  />
                }
                label={
                  system.isSuccess
                    ? "API connected"
                    : system.isPending
                      ? "Checking connection"
                      : "API unavailable"
                }
              />
            </Stack>
          </Box>
        </Box>
      </Box>
      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
      />
    </Box>
  );
}
