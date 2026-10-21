import {
  Alert,
  Button,
  CircularProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { authorizedFetch, getJson } from "../shared/api/client";
import { PageHeader } from "../shared/ui/page-header";

interface Port {
  id: string;
  status: string;
  numbers: string[];
  currentProvider: string;
  updatedAt?: string;
}
interface Customer {
  id: string;
  name: string;
  status: string;
}
interface Carrier {
  code: string;
  displayName: string;
  accounts: Array<{ id: string; externalAccountId: string; status: string }>;
}
const empty = {
  customerId: "",
  carrierAccountId: "",
  numbers: "",
  currentProvider: "",
  accountName: "",
  accountNumber: "",
  pin: "",
  line1: "",
  line2: "",
  city: "",
  region: "",
  postalCode: "",
};

export function PortsPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const ports = useQuery({
    queryKey: ["ports", status],
    queryFn: () =>
      getJson<{ items: Port[]; total: number }>(
        `/api/v1/ports${status ? `?status=${status}` : ""}`,
      ),
  });
  const customers = useQuery({
    queryKey: ["port-customers"],
    enabled: open,
    queryFn: () =>
      getJson<{ items: Customer[] }>("/api/v1/customers?page=1&pageSize=100"),
  });
  const carriers = useQuery({
    queryKey: ["port-carriers"],
    enabled: open,
    queryFn: () => getJson<Carrier[]>("/api/v1/carriers"),
  });
  function set(key: keyof typeof empty, value: string) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }
  async function save() {
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const response = await authorizedFetch("/api/v1/ports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: form.customerId,
          carrierAccountId: form.carrierAccountId,
          numbers: form.numbers.split(/[\s,;]+/).filter(Boolean),
          currentProvider: form.currentProvider,
          accountName: form.accountName,
          accountNumber: form.accountNumber,
          pin: form.pin,
          serviceAddress: {
            line1: form.line1,
            ...(form.line2 ? { line2: form.line2 } : {}),
            city: form.city,
            region: form.region,
            postalCode: form.postalCode,
          },
        }),
      });
      if (!response.ok)
        throw new Error(`Draft could not be saved (${response.status})`);
      const draft = (await response.json()) as Port;
      setForm(empty);
      setOpen(false);
      setNotice(`Draft created: ${draft.numbers.join(", ")}`);
      await queryClient.invalidateQueries({ queryKey: ["ports"] });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Draft could not be saved",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <Stack spacing={3}>
      <PageHeader
        title="Port requests"
        description="Prepare and track inbound number ports."
      />
      <Alert severity="info">
        Submitting a port is available only for the mock carrier. Live carrier
        submissions require separate authorization.
      </Alert>
      {notice && <Alert severity="success">{notice}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <Button variant="contained" onClick={() => setOpen((value) => !value)}>
          New port request
        </Button>
        <TextField
          select
          label="Status filter"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">Open requests</MenuItem>
          {[
            "DRAFT",
            "SUBMITTED",
            "DATE_CONFIRMED",
            "REJECTED",
            "COMPLETED",
            "CANCELLED",
          ].map((value) => (
            <MenuItem key={value} value={value}>
              {value.replaceAll("_", " ")}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      {open && (
        <Paper sx={{ p: 3 }}>
          <Stack spacing={2}>
            <Typography variant="h6">New port request</Typography>
            <TextField
              select
              slotProps={{ select: { native: true } }}
              label="Customer"
              value={form.customerId}
              onChange={(event) => set("customerId", event.target.value)}
            >
              <option value="" />
              {customers.data?.items
                .filter((item) => item.status === "active")
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </TextField>
            <TextField
              select
              slotProps={{ select: { native: true } }}
              label="Destination carrier account"
              value={form.carrierAccountId}
              onChange={(event) => set("carrierAccountId", event.target.value)}
            >
              <option value="" />
              {carriers.data?.flatMap((carrier) =>
                carrier.accounts
                  .filter((account) => account.status === "active")
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {carrier.displayName} · {account.externalAccountId}
                    </option>
                  )),
              )}
            </TextField>
            {(
              [
                ["numbers", "Numbers to port"],
                ["currentProvider", "Current provider"],
                ["accountName", "Account name"],
                ["accountNumber", "Account number"],
                ["pin", "Account PIN"],
                ["line1", "Address line 1"],
                ["line2", "Address line 2"],
                ["city", "City"],
                ["region", "State"],
                ["postalCode", "Postal code"],
              ] as Array<[keyof typeof empty, string]>
            ).map(([key, label]) => (
              <TextField
                key={key}
                label={label}
                name={`port-${key}`}
                autoComplete={
                  key === "accountNumber" || key === "pin"
                    ? "new-password"
                    : "off"
                }
                value={form[key]}
                onChange={(event) => set(key, event.target.value)}
                type={
                  key === "accountNumber" || key === "pin" ? "password" : "text"
                }
                multiline={key === "numbers"}
              />
            ))}
            <Button
              variant="contained"
              disabled={saving || !form.customerId || !form.carrierAccountId}
              onClick={() => void save()}
            >
              Save draft
            </Button>
          </Stack>
        </Paper>
      )}
      {ports.isPending && (
        <CircularProgress aria-label="Loading port requests" />
      )}
      {ports.isError && (
        <Alert severity="error">Could not load port requests.</Alert>
      )}
      {ports.data?.items.length === 0 && (
        <Alert severity="info">No port requests found.</Alert>
      )}
      {ports.data?.items.map((port) => (
        <Paper key={port.id} sx={{ p: 2 }}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            sx={{ justifyContent: "space-between" }}
            spacing={1}
          >
            <div>
              <Typography sx={{ fontWeight: 700 }}>
                {port.numbers.join(", ")}
              </Typography>
              <Typography variant="body2">
                {port.currentProvider} · {port.status.replaceAll("_", " ")}
              </Typography>
            </div>
            <Button component={Link} to={`/ports/${port.id}`}>
              View request
            </Button>
          </Stack>
        </Paper>
      ))}
    </Stack>
  );
}
