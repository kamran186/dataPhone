import { Box, CircularProgress, Typography } from "@mui/material";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "./model/use-auth-store";

export function RequireAuth() {
  const status = useAuthStore((state) => state.status);
  const location = useLocation();

  if (status === "unknown" || status === "checking") {
    return (
      <Box
        role="status"
        sx={{ display: "grid", placeItems: "center", minHeight: "100vh" }}
      >
        <CircularProgress aria-label="Checking session" />
        <Typography>Checking your session</Typography>
      </Box>
    );
  }
  if (status === "anonymous") {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return <Outlet />;
}

export function RequirePermission({
  permission,
  children,
}: {
  permission: string;
  children: React.ReactNode;
}) {
  const user = useAuthStore((state) => state.user);
  if (!user?.permissions.includes(permission)) {
    return <Typography>You do not have access to this page.</Typography>;
  }
  return children;
}
