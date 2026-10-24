import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../app/model/use-auth-store";
import { authorizedFetch, getJson } from "../shared/api/client";
import { Icon } from "../shared/ui/icon";
import { PageHeader } from "../shared/ui/page-header";
import { StatusBadge } from "../shared/ui/status-badge";
interface Carrier {
  id: string;
  code: string;
  displayName: string;
  capabilities: string[];
  accounts: Array<{
    id: string;
    externalAccountId: string;
    status: string;
    lastSyncedAt?: string;
    lastSync?: {
      status: string;
      seen: number;
      issues: number;
      errorCode?: string;
    };
  }>;
}
export function CarriersPage() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const carriers = useQuery({
    queryKey: ["carriers"],
    refetchInterval: 15_000,
    queryFn: () => getJson<Carrier[]>("/api/v1/carriers"),
  });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string>();
  const [configure, setConfigure] = useState<Carrier | null>(null);
  const [account, setAccount] = useState("");
  const [reference, setReference] = useState("");
  async function sync(id: string) {
    setBusy(id);
    setError("");
    setNotice("");
    try {
      const response = await authorizedFetch(`/api/v1/carriers/${id}/sync`, {
        method: "POST",
      });
      if (!response.ok)
        throw new Error(`Sync could not start (${response.status})`);
      setNotice(
        "Synchronization queued. Follow its progress in Background jobs.",
      );
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Sync could not start.",
      );
    } finally {
      setBusy(undefined);
    }
  }
  async function save() {
    if (!configure || !account.trim()) return;
    setBusy("configure");
    setError("");
    try {
      const response = await authorizedFetch(
        `/api/v1/carriers/${configure.id}/accounts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            externalAccountId: account.trim(),
            ...(reference.trim() ? { credentialRef: reference.trim() } : {}),
          }),
        },
      );
      if (!response.ok)
        throw new Error(`Account could not be configured (${response.status})`);
      setConfigure(null);
      setNotice("Carrier account configured.");
      await queryClient.invalidateQueries({ queryKey: ["carriers"] });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Account could not be configured.",
      );
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <Stack spacing={3}>
      <PageHeader
        title="Carriers"
        description="The infrastructure behind every connection."
      />
      {notice && (
        <Alert severity="success" onClose={() => setNotice("")}>
          {notice}
          {user?.permissions.includes("jobs.view") && (
            <Button component={Link} to="/jobs" size="small">
              View jobs
            </Button>
          )}
        </Alert>
      )}
      {error && !configure && <Alert severity="error">{error}</Alert>}
      {carriers.isPending && <Skeleton height={260} variant="rounded" />}
      {carriers.isError && (
        <Alert
          severity="error"
          action={
            <Button onClick={() => void carriers.refetch()}>Retry</Button>
          }
        >
          Unable to load carriers.
        </Alert>
      )}
      {carriers.data?.length === 0 && (
        <Alert severity="info">No carriers are configured.</Alert>
      )}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", xl: "1fr 1fr" },
          gap: 3,
        }}
      >
        {carriers.data?.map((carrier) => (
          <Paper key={carrier.id ?? carrier.code} sx={{ p: 3 }}>
            <Stack
              direction="row"
              spacing={2}
              sx={{ alignItems: "center", mb: 2 }}
            >
              <Box
                sx={{
                  width: 42,
                  height: 42,
                  bgcolor: "var(--dp-glow)",
                  color: "primary.main",
                  borderRadius: 2,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <Icon name="carrier" />
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography variant="h6">{carrier.displayName}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {carrier.accounts.length} connected{" "}
                  {carrier.accounts.length === 1 ? "account" : "accounts"}
                </Typography>
              </Box>
              {user?.permissions.includes("carriers.configure") && (
                <Button
                  startIcon={<Icon name="plus" sx={{ fontSize: 14 }} />}
                  onClick={() => {
                    setConfigure(carrier);
                    setAccount("");
                    setReference("");
                    setError("");
                  }}
                >
                  Add account
                </Button>
              )}
            </Stack>
            <Stack
              direction="row"
              useFlexGap
              sx={{ flexWrap: "wrap", gap: 0.75, mb: 3 }}
            >
              {carrier.capabilities?.map((capability) => (
                <Box
                  key={capability}
                  component="span"
                  sx={{
                    fontSize: 10,
                    color: "text.secondary",
                    bgcolor: "var(--dp-raised)",
                    px: 1,
                    py: 0.5,
                    borderRadius: 0.75,
                  }}
                >
                  {capability.replaceAll(".", " · ")}
                </Box>
              ))}
            </Stack>
            {carrier.accounts.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                No accounts connected to this carrier.
              </Typography>
            )}
            {carrier.accounts.map((item) => (
              <Box
                key={item.id}
                sx={{
                  pt: 2,
                  mt: 2,
                  borderTop: "1px solid",
                  borderColor: "divider",
                }}
              >
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center", mb: 1 }}
                >
                  <Typography
                    variant="body2"
                    sx={{ flex: 1, fontWeight: 600, overflowWrap: "anywhere" }}
                  >
                    {item.externalAccountId}
                  </Typography>
                  <StatusBadge status={item.status} />
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {item.lastSyncedAt
                    ? `Last synchronized ${new Date(item.lastSyncedAt).toLocaleString()}`
                    : "Not yet synchronized"}
                </Typography>
                {item.lastSync && (
                  <Stack
                    direction="row"
                    useFlexGap
                    sx={{
                      gap: 1,
                      mt: 1,
                      flexWrap: "wrap",
                      alignItems: "center",
                    }}
                  >
                    <StatusBadge status={item.lastSync.status} />
                    <Typography variant="caption" color="text.secondary">
                      {item.lastSync.seen} numbers seen · {item.lastSync.issues}{" "}
                      issues
                    </Typography>
                  </Stack>
                )}
                {item.lastSync?.errorCode && (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    {item.lastSync.errorCode}
                  </Alert>
                )}
                {user?.permissions.includes("sync.trigger") && (
                  <Button
                    startIcon={<Icon name="refresh" sx={{ fontSize: 14 }} />}
                    sx={{ mt: 1 }}
                    disabled={
                      Boolean(busy) ||
                      !carrier.capabilities?.includes("inventory.list") ||
                      item.status !== "active"
                    }
                    onClick={() => void sync(item.id)}
                  >
                    {busy === item.id ? "Queuing…" : "Sync now"}
                  </Button>
                )}
              </Box>
            ))}
          </Paper>
        ))}
      </Box>
      <Dialog
        open={Boolean(configure)}
        onClose={() => !busy && setConfigure(null)}
        maxWidth="sm"
        aria-labelledby="configure-carrier"
      >
        <DialogTitle id="configure-carrier">
          Connect {configure?.displayName} account
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              autoFocus
              required
              label="External account ID"
              value={account}
              onChange={(event) => setAccount(event.target.value)}
            />
            <TextField
              label="Credential reference (optional)"
              helperText="Use the reference configured by your administrator. Do not enter a secret."
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfigure(null)} disabled={Boolean(busy)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={!account.trim() || Boolean(busy)}
            onClick={() => void save()}
          >
            Connect account
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
