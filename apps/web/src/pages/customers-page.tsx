import {
  Alert,
  Button,
  Box,
  TableContainer,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Skeleton,
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
import { Icon } from "../shared/ui/icon";
import { StatusBadge } from "../shared/ui/status-badge";
import { SearchHighlight } from "../shared/ui/data-tools";
import { useDebouncedValue } from "../shared/lib/use-debounced-value";
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
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const params = new URLSearchParams({ page: String(page), pageSize: "25" });
  if (debouncedSearch.length >= 2) params.set("search", debouncedSearch);
  const customers = useQuery({
    queryKey: ["customers", params.toString()],
    queryFn: () =>
      getJson<{ items: CustomerRow[]; total: number; pageSize: number }>(
        `/api/v1/customers?${params}`,
      ),
  });

  async function create() {
    if (!name.trim() || !externalId.trim() || saving) return;
    setError("");
    setSaving(true);
    try {
      const response = await authorizedFetch("/api/v1/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          externalId: externalId.trim(),
        }),
      });
      if (!response.ok)
        throw new Error(`Customer could not be created (${response.status})`);
      setOpen(false);
      setNotice("Customer created successfully.");
      setName("");
      setExternalId("");
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Customer could not be created",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Customers"
        description="Manage customer records and assigned numbers."
      />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
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
          <Button
            variant="contained"
            startIcon={<Icon name="plus" sx={{ fontSize: 15 }} />}
            onClick={() => {
              setError("");
              setOpen(true);
            }}
          >
            Add customer
          </Button>
        )}
      </Stack>
      {notice && (
        <Alert severity="success" onClose={() => setNotice("")}>
          {notice}
        </Alert>
      )}
      {customers.isPending && (
        <Skeleton
          aria-label="Loading customers"
          height={260}
          variant="rounded"
        />
      )}
      {customers.isError && (
        <Alert severity="error">Unable to load customers.</Alert>
      )}
      {customers.data && (
        <Paper sx={{ overflow: "hidden", "& > .MuiStack-root": { p: 2 } }}>
          {customers.data.items.length === 0 && (
            <Typography>No customers match this search.</Typography>
          )}
          <TableContainer
            tabIndex={0}
            role="region"
            aria-label="Customer records"
            sx={{ maxHeight: "65vh" }}
          >
            <Table stickyHeader aria-label="Customers">
              <TableHead>
                <TableRow>
                  <TableCell>Customer</TableCell>
                  <TableCell>External ID</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Details</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {customers.data.items.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell>
                      <Box
                        sx={{ display: "flex", alignItems: "center", gap: 1.5 }}
                      >
                        <Box
                          sx={{
                            bgcolor: "var(--dp-glow)",
                            color: "primary.main",
                            width: 30,
                            height: 30,
                            display: "grid",
                            placeItems: "center",
                            borderRadius: 1.5,
                            fontWeight: 650,
                          }}
                        >
                          {customer.name.slice(0, 1).toUpperCase()}
                        </Box>
                        <Link
                          to={`/customers/${customer.id}`}
                          style={{ textDecoration: "none", fontWeight: 600 }}
                        >
                          <SearchHighlight
                            text={customer.name}
                            search={search}
                          />
                        </Link>
                      </Box>
                    </TableCell>
                    <TableCell sx={{ color: "text.secondary" }}>
                      {customer.externalId}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={customer.status} />
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        component={Link}
                        to={`/customers/${customer.id}`}
                        aria-label={`View ${customer.name}`}
                        sx={{ minWidth: 32 }}
                      >
                        <Icon name="chevron" sx={{ fontSize: 16 }} />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
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
        onClose={() => !saving && setOpen(false)}
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
          <Button
            variant="contained"
            disabled={saving || !name.trim() || !externalId.trim()}
            onClick={() => void create()}
          >
            Create customer
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
