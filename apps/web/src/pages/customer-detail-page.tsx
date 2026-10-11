import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuthStore } from "../app/model/use-auth-store";
import { authorizedFetch, getJson } from "../shared/api/client";

interface Customer {
  id: string;
  name: string;
  externalId: string;
  status: string;
  version: number;
}
interface CustomerNumber {
  id: string;
  e164: string;
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

export function CustomerDetailPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const canManage = Boolean(user?.permissions.includes("customers.manage"));
  const canAudit = Boolean(user?.permissions.includes("audit.view"));
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState("");
  const [status, setStatus] = useState("active");
  const [error, setError] = useState("");
  const [historyType, setHistoryType] = useState("");
  const [numbersPage, setNumbersPage] = useState(1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const historyParams = new URLSearchParams({
    page: String(historyPage),
    pageSize: "25",
  });
  if (historyType) historyParams.set("type", historyType);
  if (from) historyParams.set("from", from);
  if (to) historyParams.set("to", to);
  const customer = useQuery({
    queryKey: ["customer", id],
    enabled: Boolean(id),
    queryFn: () => getJson<Customer>(`/api/v1/customers/${id}`),
  });
  const numbers = useQuery({
    queryKey: ["customer-numbers", id, numbersPage],
    enabled: Boolean(id),
    queryFn: () =>
      getJson<{ items: CustomerNumber[]; total: number; pageSize: number }>(
        `/api/v1/customers/${id}/numbers?page=${numbersPage}&pageSize=100`,
      ),
  });
  const history = useQuery({
    queryKey: ["customer-history", id, historyParams.toString()],
    enabled: Boolean(id && canAudit),
    queryFn: () =>
      getJson<{ items: HistoryEvent[]; total: number; pageSize: number }>(
        `/api/v1/customers/${id}/history?${historyParams}`,
      ),
  });

  async function save() {
    if (!customer.data) return;
    setError("");
    try {
      const response = await authorizedFetch(`/api/v1/customers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, status, version: customer.data.version }),
      });
      if (!response.ok)
        throw new Error(`Customer could not be updated (${response.status})`);
      setEdit(false);
      await queryClient.invalidateQueries({ queryKey: ["customer", id] });
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
      await queryClient.invalidateQueries({
        queryKey: ["customer-history", id],
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Customer could not be updated",
      );
    }
  }

  return (
    <Stack spacing={3}>
      <Link to="/customers">Back to customers</Link>
      {customer.isPending && <CircularProgress aria-label="Loading customer" />}
      {customer.isError && (
        <Alert severity="error">Unable to load customer.</Alert>
      )}
      {customer.data && (
        <>
          <Typography variant="h4" component="h1">
            {customer.data.name}
          </Typography>
          <Paper sx={{ p: 2 }}>
            <Typography>External ID: {customer.data.externalId}</Typography>
            <Typography>Status: {customer.data.status}</Typography>
            {canManage && (
              <Button
                onClick={() => {
                  setName(customer.data!.name);
                  setStatus(customer.data!.status);
                  setEdit(true);
                }}
              >
                Edit customer
              </Button>
            )}
          </Paper>
        </>
      )}
      <Typography variant="h6">Assigned numbers</Typography>
      {numbers.data?.items.length === 0 && (
        <Typography>No current numbers.</Typography>
      )}
      {numbers.data?.items.map((number) => (
        <Paper key={number.id} sx={{ p: 2 }}>
          <Link to={`/inventory/${number.id}`}>{number.e164}</Link> ·{" "}
          {number.status}
        </Paper>
      ))}
      {numbers.data && (
        <Stack direction="row" spacing={1}>
          <Button
            disabled={numbersPage === 1}
            onClick={() => setNumbersPage(numbersPage - 1)}
          >
            Previous numbers
          </Button>
          <Button
            disabled={numbersPage * numbers.data.pageSize >= numbers.data.total}
            onClick={() => setNumbersPage(numbersPage + 1)}
          >
            Next numbers
          </Button>
        </Stack>
      )}
      {canAudit && (
        <>
          <Typography variant="h6">Customer history</Typography>
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
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setHistoryPage(1);
              }}
            />
            <TextField
              size="small"
              type="date"
              label="To"
              slotProps={{ inputLabel: { shrink: true } }}
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setHistoryPage(1);
              }}
            />
          </Stack>
          {history.isError && (
            <Alert severity="error">Unable to load customer history.</Alert>
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
        open={edit}
        onClose={() => setEdit(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Edit customer</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Customer name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <TextField
              select
              label="Status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="inactive">Inactive</MenuItem>
            </TextField>
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEdit(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => void save()}>
            Save customer
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
