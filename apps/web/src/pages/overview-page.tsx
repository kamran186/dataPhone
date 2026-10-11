import {
  Alert,
  Box,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuthStore } from "../app/model/use-auth-store";
import { getJson } from "../shared/api/client";
import { PageHeader } from "../shared/ui/page-header";

interface Dashboard {
  totalDids: number;
  activeDids: number;
  assigned: number;
  potentiallyUnused: number;
  openPorts: number;
  pendingPurchases: number;
  failedJobs: number;
  byCarrier: Array<{ carrier: string; count: number }>;
  carrierSync: Array<{
    carrier: string;
    account: string;
    status: string;
    lastSyncedAt?: string;
  }>;
}
export function OverviewPage() {
  const user = useAuthStore((state) => state.user);
  const allowed = Boolean(user?.permissions.includes("reports.view"));
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    enabled: allowed,
    refetchInterval: 30_000,
    queryFn: () => getJson<Dashboard>("/api/v1/dashboard"),
  });
  const cards = dashboard.data
    ? ([
        ["Total DIDs", dashboard.data.totalDids, "/reports/all-dids"],
        ["Active DIDs", dashboard.data.activeDids, "/reports/all-dids"],
        ["Assigned", dashboard.data.assigned, "/reports/by-customer"],
        [
          "Potentially unused",
          dashboard.data.potentiallyUnused,
          "/reports/unassigned",
        ],
        ["Open ports", dashboard.data.openPorts, "/reports/open-ports"],
        [
          "Pending purchases",
          dashboard.data.pendingPurchases,
          "/reports/purchase-history",
        ],
        ["Failed jobs", dashboard.data.failedJobs, "/jobs"],
      ] as const)
    : [];
  return (
    <Stack spacing={3}>
      <PageHeader
        title="Overview"
        description="Inventory and operational activity across carrier accounts."
      />
      {!allowed && (
        <Alert severity="info">
          Your role does not include operational reporting.
        </Alert>
      )}
      {dashboard.isPending && allowed && (
        <CircularProgress aria-label="Loading dashboard" />
      )}
      {dashboard.isError && (
        <Alert severity="error">
          Could not load the dashboard. Check the API connection.
        </Alert>
      )}
      {dashboard.data && (
        <>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(2, 1fr)",
                lg: "repeat(4, 1fr)",
              },
              gap: 2,
            }}
          >
            {cards.map(([label, count, to]) => (
              <Paper
                key={label}
                component={Link}
                to={to}
                sx={{ p: 2, textDecoration: "none", color: "text.primary" }}
              >
                <Typography variant="body2">{label}</Typography>
                <Typography variant="h4">{count}</Typography>
              </Paper>
            ))}
          </Box>
          <Alert severity="info">
            Potentially unused means active carrier-held numbers without a
            customer assignment. Billing and routing usage are outside this POC.
          </Alert>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6">DIDs by carrier</Typography>
            {dashboard.data.byCarrier.length === 0 ? (
              <Typography>No carrier numbers yet.</Typography>
            ) : (
              dashboard.data.byCarrier.map((item) => (
                <Typography key={item.carrier}>
                  {item.carrier}: {item.count}
                </Typography>
              ))
            )}
          </Paper>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6">Carrier synchronization</Typography>
            {dashboard.data.carrierSync.length === 0 ? (
              <Typography>No carrier accounts configured.</Typography>
            ) : (
              dashboard.data.carrierSync.map((item) => (
                <Typography key={`${item.carrier}:${item.account}`}>
                  {item.carrier} · {item.account}:{" "}
                  {item.status.replaceAll("_", " ")}
                  {item.lastSyncedAt
                    ? ` · ${new Date(item.lastSyncedAt).toLocaleString()}`
                    : ""}
                </Typography>
              ))
            )}
          </Paper>
        </>
      )}
    </Stack>
  );
}
