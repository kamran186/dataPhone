import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuthStore } from "../app/model/use-auth-store";
import { subscribeJobEvents } from "../entities/jobs/api/job-stream";
import { authorizedFetch, getJson } from "../shared/api/client";

interface NumberDetail {
  e164: string;
  status: string;
  carrier?: string;
  carrierAccount?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  holdings: Array<{ status: string; startedAt: string; endedAt?: string }>;
  assignments: Array<{
    customerId: string;
    active: boolean;
    startedAt?: string;
    endedAt?: string;
  }>;
}
interface CustomerRow {
  id: string;
  name: string;
  status: string;
}
interface HistoryEvent {
  id: string;
  type: string;
  actorId: string;
  createdAt: string;
  previous: unknown;
  next: unknown;
}

export function NumberDetailPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const canAssign = Boolean(user?.permissions.includes("numbers.assign"));
  const canDisconnect = Boolean(
    user?.permissions.includes("numbers.disconnect"),
  );
  const canAudit = Boolean(user?.permissions.includes("audit.view"));
  const [dialog, setDialog] = useState<
    "assign" | "transfer" | "unassign" | null
  >(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [error, setError] = useState("");
  const [historyType, setHistoryType] = useState("");
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnectConfirmation, setDisconnectConfirmation] = useState("");
  const [disconnectError, setDisconnectError] = useState("");
  const [disconnectNotice, setDisconnectNotice] = useState("");
  const [disconnectId, setDisconnectId] = useState("");
  const [disconnectJobId, setDisconnectJobId] = useState("");
  const [disconnectProgress, setDisconnectProgress] = useState("");
  const customerParams = new URLSearchParams({ page: "1", pageSize: "100" });
  if (customerSearch.length >= 2) customerParams.set("search", customerSearch);
  const historyParams = new URLSearchParams({
    page: String(historyPage),
    pageSize: "25",
  });
  if (historyType) historyParams.set("type", historyType);
  if (historyFrom) historyParams.set("from", historyFrom);
  if (historyTo) historyParams.set("to", historyTo);
  const detail = useQuery({
    queryKey: ["number", id],
    enabled: Boolean(id),
    queryFn: () => getJson<NumberDetail>(`/api/v1/numbers/${id}`),
  });
  const customers = useQuery({
    queryKey: ["assignment-customers", customerParams.toString()],
    enabled: canAssign,
    queryFn: () =>
      getJson<{ items: CustomerRow[] }>(`/api/v1/customers?${customerParams}`),
  });
  const history = useQuery({
    queryKey: ["number-history", id, historyParams.toString()],
    enabled: Boolean(id && canAudit),
    queryFn: () =>
      getJson<{ items: HistoryEvent[]; total: number; pageSize: number }>(
        `/api/v1/numbers/${id}/history?${historyParams}`,
      ),
  });
  const disconnect = useQuery({
    queryKey: ["disconnect", disconnectId],
    enabled: Boolean(disconnectId),
    queryFn: () =>
      getJson<{ status: string; errorCode?: string }>(
        `/api/v1/disconnects/${disconnectId}`,
      ),
  });
  useEffect(() => {
    if (!disconnectJobId) return;
    const controller = new AbortController();
    void subscribeJobEvents(
      disconnectJobId,
      (event) => {
        setDisconnectProgress(
          `${event.type}${event.progress === undefined ? "" : ` · ${event.progress}%`}`,
        );
        if (event.type === "succeeded" || event.type === "failed") {
          void queryClient.invalidateQueries({
            queryKey: ["disconnect", disconnectId],
          });
          void queryClient.invalidateQueries({ queryKey: ["number", id] });
          void queryClient.invalidateQueries({
            queryKey: ["number-history", id],
          });
          void queryClient.invalidateQueries({ queryKey: ["numbers"] });
        }
      },
      controller.signal,
    );
    return () => controller.abort();
  }, [disconnectId, disconnectJobId, id, queryClient]);
  const active = detail.data?.assignments.find(
    (assignment) => assignment.active,
  );
  const activeName = customers.data?.items.find(
    (customer) => customer.id === active?.customerId,
  )?.name;

  async function submit() {
    if (!dialog) return;
    setError("");
    try {
      const path =
        dialog === "assign"
          ? "/api/v1/assignments"
          : `/api/v1/assignments/${dialog}`;
      const response = await authorizedFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numberId: id,
          ...(dialog === "unassign" ? {} : { customerId: selectedCustomer }),
        }),
      });
      if (!response.ok)
        throw new Error(`Assignment could not be changed (${response.status})`);
      setDialog(null);
      setSelectedCustomer("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["number", id] }),
        queryClient.invalidateQueries({ queryKey: ["number-history", id] }),
        queryClient.invalidateQueries({ queryKey: ["customer-numbers"] }),
        queryClient.invalidateQueries({ queryKey: ["customer-history"] }),
        queryClient.invalidateQueries({ queryKey: ["numbers"] }),
      ]);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Assignment could not be changed",
      );
    }
  }

  async function submitDisconnect() {
    if (!id || !detail.data || disconnectConfirmation !== detail.data.e164)
      return;
    setDisconnectError("");
    try {
      const response = await authorizedFetch(
        `/api/v1/numbers/${id}/disconnect`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmE164: disconnectConfirmation,
            idempotencyKey: crypto.randomUUID(),
          }),
        },
      );
      if (!response.ok)
        throw new Error(
          `Disconnect could not be requested (${response.status})`,
        );
      const request = (await response.json()) as { id: string; jobId: string };
      setDisconnectId(request.id);
      setDisconnectJobId(request.jobId);
      setDisconnectNotice(`Disconnect queued: ${request.id}`);
      setDisconnectOpen(false);
      setDisconnectConfirmation("");
    } catch (cause) {
      setDisconnectError(
        cause instanceof Error
          ? cause.message
          : "Disconnect could not be requested",
      );
    }
  }

  return (
    <Stack spacing={2}>
      <Link to="/inventory">Back to inventory</Link>
      {detail.isPending && <CircularProgress aria-label="Loading number" />}
      {detail.isError && (
        <Alert severity="error">Unable to load this number.</Alert>
      )}
      {disconnectNotice && <Alert severity="success">{disconnectNotice}</Alert>}
      {disconnectProgress && (
        <Alert severity="info">Disconnect progress: {disconnectProgress}</Alert>
      )}
      {disconnect.data && (
        <Alert
          severity={disconnect.data.status === "failed" ? "error" : "info"}
        >
          Disconnect status: {disconnect.data.status}
          {disconnect.data.errorCode ? ` · ${disconnect.data.errorCode}` : ""}
        </Alert>
      )}
      {detail.data && (
        <>
          <Typography variant="h4" component="h1">
            {detail.data.e164}
          </Typography>
          <Paper sx={{ p: 2 }}>
            <Typography>Status: {detail.data.status}</Typography>
            <Typography>Carrier: {detail.data.carrier ?? "Unknown"}</Typography>
            <Typography>
              Account: {detail.data.carrierAccount ?? "Unknown"}
            </Typography>
            <Typography>
              First seen: {new Date(detail.data.firstSeenAt).toLocaleString()}
            </Typography>
            <Typography>
              Last seen: {new Date(detail.data.lastSeenAt).toLocaleString()}
            </Typography>
          </Paper>
          <Typography variant="h6">Carrier holding history</Typography>
          {detail.data.holdings.map((holding, index) => (
            <Paper key={index} sx={{ p: 2 }}>
              {holding.status} · {new Date(holding.startedAt).toLocaleString()}
              {holding.endedAt
                ? ` to ${new Date(holding.endedAt).toLocaleString()}`
                : " to present"}
            </Paper>
          ))}
          <Typography variant="h6">Customer assignment history</Typography>
          {detail.data.assignments.length === 0 && (
            <Typography>No customer assignment recorded.</Typography>
          )}
          {detail.data.assignments.map((assignment, index) => (
            <Paper key={index} sx={{ p: 2 }}>
              Customer {assignment.customerId} ·{" "}
              {assignment.active ? "Current" : "Past"}
              {assignment.startedAt &&
                ` · from ${new Date(assignment.startedAt).toLocaleString()}`}
              {assignment.endedAt &&
                ` to ${new Date(assignment.endedAt).toLocaleString()}`}
            </Paper>
          ))}
          {active && (
            <Typography>
              Current customer: {activeName ?? active.customerId}
            </Typography>
          )}
          {canAssign && (
            <Stack direction="row" spacing={1}>
              {!active && detail.data.status === "active" && (
                <Button variant="contained" onClick={() => setDialog("assign")}>
                  Assign number
                </Button>
              )}
              {active && (
                <>
                  <Button onClick={() => setDialog("transfer")}>
                    Transfer number
                  </Button>
                  <Button color="error" onClick={() => setDialog("unassign")}>
                    Unassign number
                  </Button>
                </>
              )}
            </Stack>
          )}
          {canDisconnect && detail.data.status === "active" && (
            <Stack spacing={1}>
              <Button
                color="error"
                variant="outlined"
                disabled={detail.data.carrier !== "mock"}
                onClick={() => setDisconnectOpen(true)}
              >
                Disconnect number
              </Button>
              {detail.data.carrier !== "mock" && (
                <Typography color="text.secondary">
                  Live carrier disconnects are disabled.
                </Typography>
              )}
            </Stack>
          )}
        </>
      )}
      {canAudit && (
        <>
          <Typography variant="h6">Number history</Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <TextField
              size="small"
              label="Event type"
              value={historyType}
              onChange={(event) => {
                setHistoryType(event.target.value);
                setHistoryPage(1);
              }}
            />
            <TextField
              size="small"
              type="date"
              label="From"
              slotProps={{ inputLabel: { shrink: true } }}
              value={historyFrom}
              onChange={(event) => {
                setHistoryFrom(event.target.value);
                setHistoryPage(1);
              }}
            />
            <TextField
              size="small"
              type="date"
              label="To"
              slotProps={{ inputLabel: { shrink: true } }}
              value={historyTo}
              onChange={(event) => {
                setHistoryTo(event.target.value);
                setHistoryPage(1);
              }}
            />
          </Stack>
          {history.isError && (
            <Alert severity="error">Unable to load number history.</Alert>
          )}
          {history.data?.items.map((event) => (
            <Paper key={event.id} sx={{ p: 2 }}>
              <Typography>{event.type}</Typography>
              <Typography color="text.secondary">
                {new Date(event.createdAt).toLocaleString()} · Actor{" "}
                {event.actorId}
              </Typography>
              <Typography
                component="pre"
                sx={{ overflowX: "auto", whiteSpace: "pre-wrap" }}
              >
                {JSON.stringify({ previous: event.previous, next: event.next })}
              </Typography>
            </Paper>
          ))}
          {history.data && (
            <Stack direction="row" spacing={1}>
              <Button
                disabled={historyPage === 1}
                onClick={() => setHistoryPage(historyPage - 1)}
              >
                Previous history
              </Button>
              <Button
                disabled={
                  historyPage * history.data.pageSize >= history.data.total
                }
                onClick={() => setHistoryPage(historyPage + 1)}
              >
                Next history
              </Button>
            </Stack>
          )}
        </>
      )}
      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {dialog === "assign"
            ? "Assign number"
            : dialog === "transfer"
              ? "Transfer number"
              : "Unassign number"}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {dialog !== "unassign" && (
              <>
                <TextField
                  label="Find customer"
                  value={customerSearch}
                  onChange={(event) => setCustomerSearch(event.target.value)}
                />
                <FormControl fullWidth>
                  <InputLabel htmlFor="assignment-customer">
                    Customer
                  </InputLabel>
                  <Select
                    native
                    label="Customer"
                    inputProps={{
                      id: "assignment-customer",
                      "aria-label": "Customer",
                    }}
                    value={selectedCustomer}
                    onChange={(event) =>
                      setSelectedCustomer(String(event.target.value))
                    }
                  >
                    <option value="">Select a customer</option>
                    {customers.data?.items
                      .filter((customer) => customer.status === "active")
                      .map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.name}
                        </option>
                      ))}
                  </Select>
                </FormControl>
              </>
            )}
            {dialog === "unassign" && (
              <Typography>
                Remove this number from its current customer?
              </Typography>
            )}
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>Cancel</Button>
          <Button
            variant="contained"
            color={dialog === "unassign" ? "error" : "primary"}
            disabled={dialog !== "unassign" && !selectedCustomer}
            onClick={() => void submit()}
          >
            {dialog === "assign"
              ? "Confirm assignment"
              : dialog === "transfer"
                ? "Confirm transfer"
                : "Confirm unassignment"}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Disconnect number</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography>
              Type {detail.data?.e164} to confirm this disconnect.
            </Typography>
            <TextField
              label="Type number to confirm"
              value={disconnectConfirmation}
              onChange={(event) =>
                setDisconnectConfirmation(event.target.value)
              }
            />
            {disconnectError && (
              <Alert severity="error">{disconnectError}</Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDisconnectOpen(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={disconnectConfirmation !== detail.data?.e164}
            onClick={() => void submitDisconnect()}
          >
            Confirm disconnect
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
