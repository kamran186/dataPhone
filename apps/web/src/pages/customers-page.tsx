import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../app/model/use-auth-store";
import { authorizedFetch, getJson } from "../shared/api/client";
import { PageHeader } from "../shared/ui/page-header";

interface CustomerRow {
  id: string;
  externalId: string;
  name: string;
  status: string;
  version: number;
}

export function CustomersPage() {
  const queryClient = useQueryClient();
  const canManage = useAuthStore((state) =>
    Boolean(state.user?.permissions.includes("customers.manage")),
  );
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [externalId, setExternalId] = useState("");
  const [error, setError] = useState("");
  const params = new URLSearchParams({ page: String(page), pageSize: "25" });
  if (search.length >= 2) params.set("search", search);
  const customers = useQuery({
    queryKey: ["customers", params.toString()],
    queryFn: () =>
      getJson<{ items: CustomerRow[]; total: number; pageSize: number }>(
        `/api/v1/customers?${params}`,
      ),
  });

  async function create() {
    setError("");
    try {
      const response = await authorizedFetch("/api/v1/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, externalId }),
      });
      if (!response.ok)
        throw new Error(`Customer could not be created (${response.status})`);
      setOpen(false);
      setName("");
      setExternalId("");
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Customer could not be created",
      );
    }
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Customers"
        description="Manage customer records and assigned numbers."
      />
      <Stack direction="row" spacing={2}>
        <TextField
          size="small"
          label="Search customers"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        {canManage && (
          <Button variant="contained" onClick={() => setOpen(true)}>
            Add customer
          </Button>
        )}
      </Stack>
      {customers.isPending && (
        <CircularProgress aria-label="Loading customers" />
      )}
      {customers.isError && (
        <Alert severity="error">Unable to load customers.</Alert>
      )}
      {customers.data && (
        <Paper sx={{ p: 2 }}>
          {customers.data.items.length === 0 && (
            <Typography>No customers match this search.</Typography>
          )}
          {customers.data.items.map((customer) => (
            <Stack
              key={customer.id}
              direction="row"
              spacing={2}
              sx={{ py: 1, alignItems: "center" }}
            >
              <Link to={`/customers/${customer.id}`}>{customer.name}</Link>
              <Typography color="text.secondary">
                {customer.externalId}
              </Typography>
              <Typography color="text.secondary">{customer.status}</Typography>
            </Stack>
          ))}
          <Stack
            direction="row"
            spacing={1}
            sx={{ mt: 2, alignItems: "center" }}
          >
            <Typography sx={{ flexGrow: 1 }}>
              {customers.data.total} customers · page {page}
            </Typography>
            <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button
              disabled={page * customers.data.pageSize >= customers.data.total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </Stack>
        </Paper>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Add customer</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Customer name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <TextField
              label="External ID"
              value={externalId}
              onChange={(event) => setExternalId(event.target.value)}
            />
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => void create()}>
            Create customer
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
