import {
  Alert,
  Box,
  Button,
  Divider,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuthStore } from "../app/model/use-auth-store";
import { getJson } from "../shared/api/client";
import { Icon, type IconName } from "../shared/ui/icon";
import { NetworkGlobe } from "../shared/ui/module-background";
import { StatusBadge } from "../shared/ui/status-badge";
import type { Dashboard } from "../entities/dashboard/api/types";
import { OwnershipActivity } from "../widgets/network-overview/ui/ownership-activity";
import { CarrierDistribution } from "../widgets/network-overview/ui/carrier-distribution";
import { PageHeader } from "../shared/ui/page-header";

interface RecentJob {
  id: string;
  type: string;
  status: string;
  progress: number;
  createdAt: string;
}
const numberFormat = new Intl.NumberFormat();

export function OverviewPage() {
  const user = useAuthStore((state) => state.user);
  const allowed = Boolean(user?.permissions.includes("reports.view"));
  const can = (permission: string) =>
    Boolean(user?.permissions.includes(permission));
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    enabled: allowed,
    refetchInterval: 30_000,
    queryFn: () => getJson<Dashboard>("/api/v1/dashboard"),
  });
  const jobs = useQuery({
    queryKey: ["jobs"],
    enabled: can("jobs.view"),
    refetchInterval: 15_000,
    queryFn: () => getJson<{ items: RecentJob[] }>("/api/v1/jobs"),
  });
  const data = dashboard.data;
  const cards: {
    label: string;
    count?: number;
    detail: string;
    icon: IconName;
    to: string;
    tone: string;
  }[] = [
    {
      label: "Total DIDs",
      count: data?.totalDids,
      detail: "Across all carrier accounts",
      icon: "numbers",
      to: "/reports/all-dids",
      tone: "primary",
    },
    {
      label: "Active DIDs",
      count: data?.activeDids,
      detail: "Active carrier-held numbers",
      icon: "jobs",
      to: "/reports/all-dids",
      tone: "success",
    },
    {
      label: "Assigned",
      count: data?.assigned,
      detail: "Connected to your customers",
      icon: "customers",
      to: "/reports/by-customer",
      tone: "violet",
    },
    {
      label: "Potentially unused",
      count: data?.potentiallyUnused,
      detail: "Active, without an assignment",
      icon: "globe",
      to: "/reports/unassigned",
      tone: "cyan",
    },
  ];
  return (
    <Stack spacing={3}>
      <PageHeader
        title="Overview"
        description="A clearer perspective on everything connected."
        actions={
          <Button
            onClick={() => void dashboard.refetch()}
            startIcon={<Icon name="refresh" sx={{ fontSize: 15 }} />}
            variant="outlined"
            disabled={!allowed || dashboard.isFetching}
          >
            Refresh overview
          </Button>
        }
      />
      <Box className="dashboard-hero">
        <div className="hero-globe">
          <NetworkGlobe />
        </div>
        <span className="hero-orbit-label">
          INTELLIGENT NETWORKS / CONNECTED POSSIBILITIES
        </span>
        <Box
          sx={{
            position: "relative",
            zIndex: 1,
            p: { xs: 3, md: 4 },
            maxWidth: { xs: "100%", md: "66%" },
          }}
        >
          <div className="eyebrow" style={{ marginBottom: 16 }}>
            <Icon name="globe" sx={{ fontSize: 13, color: "primary.main" }} />{" "}
            YOUR NETWORK, REIMAGINED
          </div>
          <Typography
            component="h2"
            sx={{
              fontSize: { xs: 30, lg: 38 },
              fontWeight: 550,
              letterSpacing: "-.05em",
              lineHeight: 1.12,
              mb: 1.5,
            }}
          >
            Every connection.
            <br />
            One extraordinary view.
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ maxWidth: 330, mb: 2.5 }}
          >
            Bring your numbers, carriers, and operations into focus. Built for
            the way your network moves.
          </Typography>
          <Stack direction="row" spacing={1}>
            {can("inventory.view") && (
              <Button
                component={Link}
                to="/inventory"
                variant="contained"
                endIcon={<Icon name="arrow" sx={{ fontSize: 14 }} />}
              >
                Explore inventory
              </Button>
            )}
            {can("inventory.view") && (
              <Button
                component={Link}
                to="/search"
                sx={{ color: "text.primary" }}
              >
                Find a number
              </Button>
            )}
          </Stack>
        </Box>
      </Box>
      {!allowed && (
        <Alert severity="info">
          Your role does not include operational reporting. Use the navigation
          to access your available tools.
        </Alert>
      )}
      {dashboard.isError && (
        <Alert
          severity="error"
          action={
            <Button onClick={() => void dashboard.refetch()}>Retry</Button>
          }
        >
          Could not load the dashboard. Check the API connection.
        </Alert>
      )}
      {allowed && (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              sm: "repeat(2, 1fr)",
              xl: "repeat(4, 1fr)",
              lg: "repeat(4, 1fr)",
            },
            gap: 2,
          }}
        >
          {cards.map((card) => (
            <Paper
              key={card.label}
              className="kpi-card"
              component={Link}
              to={card.to}
              sx={{
                p: 2.5,
                textDecoration: "none",
                color: "text.primary",
                minHeight: 150,
              }}
            >
              <Stack
                direction="row"
                sx={{
                  justifyContent: "space-between",
                  alignItems: "center",
                  mb: 2,
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  {card.label}
                </Typography>
                <Box
                  sx={{
                    color: `var(--dp-${card.tone})`,
                    bgcolor: `color-mix(in srgb, var(--dp-${card.tone}) 10%, transparent)`,
                    width: 29,
                    height: 29,
                    display: "grid",
                    placeItems: "center",
                    borderRadius: 1,
                  }}
                >
                  <Icon name={card.icon} sx={{ fontSize: 16 }} />
                </Box>
              </Stack>
              {card.count === undefined ? (
                <Skeleton width="55%" height={45} />
              ) : (
                <Typography
                  sx={{
                    fontSize: 32,
                    lineHeight: 1.15,
                    fontWeight: 650,
                    letterSpacing: "-.05em",
                    fontVariantNumeric: "tabular-nums",
                    mb: 1,
                  }}
                >
                  {numberFormat.format(card.count)}
                </Typography>
              )}
              <Typography sx={{ fontSize: 10, color: "text.secondary" }}>
                {card.detail}
              </Typography>
            </Paper>
          ))}
        </Box>
      )}
      {data && (
        <>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" },
              gap: 3,
            }}
          >
            <CarrierDistribution items={data.byCarrier} />
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6">Operations pulse</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                The work keeping your network moving
              </Typography>
              {(
                [
                  {
                    label: "Open ports",
                    count: data.openPorts,
                    detail: "Network transitions in progress",
                    icon: "ports",
                    to: "/reports/open-ports",
                  },
                  {
                    label: "Pending purchases",
                    count: data.pendingPurchases,
                    detail: "Orders awaiting fulfillment",
                    icon: "purchase",
                    to: "/reports/purchase-history",
                  },
                  {
                    label: "Failed jobs",
                    count: data.failedJobs,
                    detail: "Processing tasks requiring attention",
                    icon: "jobs",
                    to: can("jobs.view") ? "/jobs" : "/reports/sync-failures",
                  },
                ] as const
              ).map((item, i) => (
                <Box key={item.label}>
                  <Stack
                    component={Link}
                    to={item.to}
                    direction="row"
                    spacing={1.5}
                    sx={{
                      py: 1.5,
                      alignItems: "center",
                      textDecoration: "none",
                      color: "text.primary",
                    }}
                  >
                    <Box
                      sx={{
                        width: 34,
                        height: 34,
                        borderRadius: 1.5,
                        display: "grid",
                        placeItems: "center",
                        bgcolor: "var(--dp-raised)",
                        color: "primary.main",
                      }}
                    >
                      <Icon name={item.icon} sx={{ fontSize: 17 }} />
                    </Box>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {item.label}
                      </Typography>
                      <Typography
                        sx={{ fontSize: 10, color: "text.secondary" }}
                      >
                        {item.detail}
                      </Typography>
                    </Box>
                    <Typography sx={{ fontSize: 20, fontWeight: 600 }}>
                      {item.count}
                    </Typography>
                    <Icon
                      name="chevron"
                      sx={{ fontSize: 14, color: "text.secondary" }}
                    />
                  </Stack>
                  {i < 2 && <Divider />}
                </Box>
              ))}
            </Paper>
          </Box>
          <Paper sx={{ overflow: "hidden" }}>
            <Stack
              direction="row"
              sx={{
                px: 3,
                py: 2.5,
                justifyContent: "space-between",
                alignItems: "center",
                borderBottom: "1px solid",
                borderColor: "divider",
              }}
            >
              <Box>
                <Typography variant="h6">Carrier synchronization</Typography>
                <Typography variant="body2" color="text.secondary">
                  A direct view of your connected accounts
                </Typography>
              </Box>
              {can("inventory.view") && (
                <Button
                  component={Link}
                  to="/carriers"
                  endIcon={<Icon name="arrow" sx={{ fontSize: 14 }} />}
                >
                  View carriers
                </Button>
              )}
            </Stack>
            {data.carrierSync.length === 0 ? (
              <Typography sx={{ p: 3 }} color="text.secondary">
                No carrier accounts configured.
              </Typography>
            ) : (
              data.carrierSync.map((item) => (
                <Stack
                  key={`${item.carrier}:${item.account}`}
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1.5}
                  sx={{
                    px: 3,
                    py: 2,
                    alignItems: { sm: "center" },
                    borderBottom: "1px solid",
                    borderColor: "divider",
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1.5,
                      flex: 1,
                    }}
                  >
                    <Icon
                      name="carrier"
                      sx={{ fontSize: 18, color: "primary.main" }}
                    />
                    <Box>
                      <Typography
                        variant="body2"
                        sx={{ textTransform: "capitalize", fontWeight: 600 }}
                      >
                        {item.carrier}
                      </Typography>
                      <Typography
                        sx={{ fontSize: 11, color: "text.secondary" }}
                      >
                        {item.account}
                      </Typography>
                    </Box>
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {item.lastSyncedAt
                      ? new Date(item.lastSyncedAt).toLocaleString()
                      : "No completed sync"}
                  </Typography>
                  <StatusBadge status={item.status} />
                </Stack>
              ))
            )}
          </Paper>
          {data.failedJobs > 0 && (
            <Alert severity="warning">
              {data.failedJobs} failed processing{" "}
              {data.failedJobs === 1 ? "task needs" : "tasks need"} review. Open
              background jobs to inspect the failure details.
            </Alert>
          )}
          <Typography variant="caption" color="text.secondary">
            Inventory refreshes every 30 seconds. “Potentially unused” describes
            active numbers without a customer assignment; Billing and routing
            usage are outside this POC.
          </Typography>
        </>
      )}
      {allowed && <OwnershipActivity />}
      {can("jobs.view") && (
        <Paper sx={{ p: 3 }}>
          <Stack
            direction="row"
            sx={{
              alignItems: "center",
              justifyContent: "space-between",
              mb: 2,
            }}
          >
            <Typography variant="h6">Recent processing activity</Typography>
            <Button
              component={Link}
              to="/jobs"
              endIcon={<Icon name="arrow" sx={{ fontSize: 14 }} />}
            >
              All jobs
            </Button>
          </Stack>
          {jobs.isPending && <Skeleton height={70} />}
          {jobs.isError && (
            <Alert severity="warning">
              Processing activity is unavailable.
            </Alert>
          )}
          {jobs.data?.items?.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No background jobs yet. Activity will appear as operations run.
            </Typography>
          )}
          {jobs.data?.items?.slice(0, 5).map((job) => (
            <Stack
              key={job.id}
              direction="row"
              spacing={2}
              sx={{
                py: 1.5,
                alignItems: "center",
                borderTop: "1px solid",
                borderColor: "divider",
              }}
            >
              <Icon name="jobs" sx={{ fontSize: 18, color: "primary.main" }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                  {job.type}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {new Date(job.createdAt).toLocaleString()}
                </Typography>
              </Box>
              <StatusBadge status={job.status} />
            </Stack>
          ))}
        </Paper>
      )}
    </Stack>
  );
}
