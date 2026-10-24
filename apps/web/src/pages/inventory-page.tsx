import {
  Alert,
  Box,
  IconButton,
  LinearProgress,
  Tooltip,
  Menu,
  TableContainer,
  Skeleton,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../app/model/use-auth-store";
import { authorizedFetch, getJson } from "../shared/api/client";
import {
  DensityControl,
  CopyAction,
  SearchHighlight,
} from "../shared/ui/data-tools";
import { StatusBadge } from "../shared/ui/status-badge";
import { Icon } from "../shared/ui/icon";
import { useDebouncedValue } from "../shared/lib/use-debounced-value";
import { NumberPreview } from "../features/number-preview/ui/number-preview";
import { PageHeader } from "../shared/ui/page-header";

interface NumberRow {
  id: string;
  e164: string;
  status: string;
  carrier?: string;
  customerName?: string;
  updatedAt: string;
}
interface CarrierRow {
  id: string;
  displayName: string;
  code: string;
  capabilities: string[];
  accounts: Array<{
    id: string;
    externalAccountId: string;
    status: string;
    lastSyncedAt?: string;
    lastSync?: {
      status: string;
      startedAt: string;
      seen: number;
      issues: number;
      errorCode?: string;
    };
  }>;
}

export function InventoryPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const canAssign = Boolean(user?.permissions.includes("numbers.assign"));
  const [compact, setCompact] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [columnAnchor, setColumnAnchor] = useState<HTMLElement | null>(null);
  const [columns, setColumns] = useState([
    "status",
    "carrier",
    "customer",
    "updated",
  ]);
  const [search, setSearch] = useState("");
  const [customer, setCustomer] = useState("");
  const [carrier, setCarrier] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("e164");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const debouncedCustomer = useDebouncedValue(customer);
  const customerParams = new URLSearchParams({ page: "1", pageSize: "100" });
  if (customerSearch.length >= 2) customerParams.set("search", customerSearch);
  const params = new URLSearchParams({
    page: String(page),
    pageSize: "50",
    sort,
  });
  if (debouncedSearch) params.set("search", debouncedSearch);
  if (debouncedCustomer) params.set("customer", debouncedCustomer);
  if (carrier) params.set("carrier", carrier);
  if (status) params.set("status", status);
  const query = params.toString();
  const numbers = useQuery({
    queryKey: ["numbers", query],
    refetchInterval: 30_000,
    queryFn: () =>
      getJson<{ items: NumberRow[]; total: number; pageSize: number }>(
        `/api/v1/numbers?${query}`,
      ),
  });
  const carriers = useQuery({
    queryKey: ["carriers"],
    refetchInterval: 15_000,
    queryFn: () => getJson<CarrierRow[]>("/api/v1/carriers"),
  });
  const issues = useQuery({
    queryKey: ["reconciliation", "open"],
    refetchInterval: 30_000,
    enabled: Boolean(user?.permissions.includes("inventory.manage")),
    queryFn: () =>
      getJson<Array<{ id: string }>>(
        "/api/v1/reconciliation/issues?status=open",
      ),
  });
  const customers = useQuery({
    queryKey: ["assignment-customers", customerParams.toString()],
    enabled: canAssign && bulkOpen,
    queryFn: () =>
      getJson<{ items: Array<{ id: string; name: string; status: string }> }>(
        `/api/v1/customers?${customerParams}`,
      ),
  });

  function toggleNumber(id: string) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  async function bulkAssign() {
    if (bulkSaving) return;
    setBulkSaving(true);
    setBulkError("");
    try {
      const response = await authorizedFetch("/api/v1/assignments/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numberIds: selected,
          customerId: selectedCustomer,
        }),
      });
      if (!response.ok)
        throw new Error(`Bulk assignment failed (${response.status})`);
      setBulkOpen(false);
      setSelected([]);
      setSelectedCustomer("");
      setNotice("Assignment completed for selected numbers.");
      await queryClient.invalidateQueries({ queryKey: ["numbers"] });
    } catch (error) {
      setBulkError(
        error instanceof Error ? error.message : "Bulk assignment failed",
      );
    } finally {
      setBulkSaving(false);
    }
  }

  async function exportFile(format: "csv" | "xlsx") {
    try {
      const response = await authorizedFetch(
        `/api/v1/numbers/export?${query}&format=${format}`,
      );
      if (!response.ok) throw new Error(`Export failed (${response.status})`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `dataphone-inventory.${format}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Export failed");
    }
  }

  async function sync(accountId: string) {
    try {
      const response = await authorizedFetch(
        `/api/v1/carriers/${accountId}/sync`,
        { method: "POST" },
      );
      if (!response.ok)
        throw new Error(`Sync could not start (${response.status})`);
      setNotice("Synchronization queued. Track progress on the Jobs page.");
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Sync could not start",
      );
    }
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Inventory"
        description="Search numbers across connected carriers."
      />
      {notice && (
        <Alert
          severity={
            notice.startsWith("Synchronization") ||
            notice.startsWith("Assignment")
              ? "success"
              : "error"
          }
        >
          {notice}
        </Alert>
      )}
      <Paper sx={{ p: 2 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          useFlexGap
          sx={{
            flexWrap: "wrap",
            "& > .MuiTextField-root": { flex: 1, minWidth: 160 },
          }}
        >
          <TextField
            label="Number contains"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            size="small"
          />
          <TextField
            label="Customer name"
            value={customer}
            onChange={(event) => {
              setCustomer(event.target.value);
              setPage(1);
            }}
            size="small"
          />
          <Select
            value={carrier}
            onChange={(event) => {
              setCarrier(event.target.value);
              setPage(1);
            }}
            size="small"
            displayEmpty
            inputProps={{ "aria-label": "Carrier filter" }}
          >
            <MenuItem value="">All carriers</MenuItem>
            {carriers.data?.map((item) => (
              <MenuItem key={item.id} value={item.code}>
                {item.displayName}
              </MenuItem>
            ))}
          </Select>
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            size="small"
            displayEmpty
            inputProps={{ "aria-label": "Status filter" }}
          >
            <MenuItem value="">All statuses</MenuItem>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="missing">Missing</MenuItem>
            <MenuItem value="disconnected">Disconnected</MenuItem>
          </Select>
          <Select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            size="small"
            inputProps={{ "aria-label": "Sort by" }}
          >
            <MenuItem value="e164">Number</MenuItem>
            <MenuItem value="updatedAt">Updated</MenuItem>
            <MenuItem value="status">Status</MenuItem>
          </Select>
        </Stack>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ mt: 2, flexWrap: "wrap", alignItems: "center" }}
        >
          <Button
            startIcon={<Icon name="download" sx={{ fontSize: 15 }} />}
            onClick={() => void exportFile("csv")}
          >
            Export CSV
          </Button>
          <Button onClick={() => void exportFile("xlsx")}>Export Excel</Button>
          {(search || customer || carrier || status) && (
            <Button
              onClick={() => {
                setSearch("");
                setCustomer("");
                setCarrier("");
                setStatus("");
                setPage(1);
                setSelected([]);
              }}
            >
              Reset filters
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button
            onClick={(event) => setColumnAnchor(event.currentTarget)}
            startIcon={<Icon name="filter" sx={{ fontSize: 15 }} />}
            aria-haspopup="menu"
            aria-expanded={Boolean(columnAnchor)}
          >
            Columns
          </Button>
          <Menu
            anchorEl={columnAnchor}
            open={Boolean(columnAnchor)}
            onClose={() => setColumnAnchor(null)}
          >
            {["status", "carrier", "customer", "updated"].map((column) => (
              <MenuItem
                key={column}
                onClick={() =>
                  setColumns((before) =>
                    before.includes(column)
                      ? before.filter((item) => item !== column)
                      : [...before, column],
                  )
                }
              >
                <Checkbox
                  checked={columns.includes(column)}
                  size="small"
                  sx={{ p: 0.5, mr: 1 }}
                  slotProps={{
                    input: { "aria-label": `Show ${column} column` },
                  }}
                />
                {column[0].toUpperCase() + column.slice(1)}
              </MenuItem>
            ))}
          </Menu>
          <DensityControl compact={compact} onChange={setCompact} />
        </Stack>
      </Paper>
      {numbers.isPending && (
        <Skeleton
          aria-label="Loading inventory"
          variant="rounded"
          height={320}
        />
      )}
      {numbers.isFetching && !numbers.isPending && (
        <LinearProgress aria-label="Refreshing inventory" />
      )}
      {numbers.isError && (
        <Alert severity="error">
          Unable to load inventory. Check the search filters.
        </Alert>
      )}
      {numbers.data && (
        <Paper sx={{ overflow: "hidden" }}>
          <TableContainer
            sx={{ maxHeight: "70vh" }}
            tabIndex={0}
            role="region"
            aria-label="Inventory table, scroll for more columns"
          >
            <Table
              stickyHeader
              size={compact ? "small" : "medium"}
              sx={
                compact ? { "& td": { py: 0.8 }, "& th": { py: 1 } } : undefined
              }
              aria-label="Inventory numbers"
            >
              <TableHead>
                <TableRow>
                  {canAssign && <TableCell>Select</TableCell>}
                  <TableCell sortDirection={sort === "e164" ? "asc" : false}>
                    <Button
                      onClick={() => {
                        setSort("e164");
                        setPage(1);
                      }}
                      size="small"
                      sx={{
                        p: 0,
                        minWidth: 0,
                        color: "inherit",
                        fontSize: "inherit",
                        textTransform: "uppercase",
                      }}
                    >
                      Number {sort === "e164" && "↑"}
                    </Button>
                  </TableCell>
                  {columns.includes("status") && <TableCell>Status</TableCell>}
                  {columns.includes("carrier") && (
                    <TableCell>Carrier</TableCell>
                  )}
                  {columns.includes("customer") && (
                    <TableCell>Customer</TableCell>
                  )}
                  {columns.includes("updated") && (
                    <TableCell>Updated</TableCell>
                  )}
                  <TableCell align="right">Details</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {numbers.data.items.map((number) => (
                  <TableRow key={number.id}>
                    {canAssign && (
                      <TableCell>
                        <Checkbox
                          disabled={
                            number.status !== "active" ||
                            Boolean(number.customerName)
                          }
                          checked={selected.includes(number.id)}
                          onChange={() => toggleNumber(number.id)}
                          slotProps={{
                            input: { "aria-label": `Select ${number.e164}` },
                          }}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <Stack
                        direction="row"
                        spacing={0.5}
                        sx={{ alignItems: "center" }}
                      >
                        <Link
                          to={`/inventory/${number.id}`}
                          style={{
                            fontFamily: "ui-monospace, monospace",
                            textDecoration: "none",
                            fontWeight: 600,
                          }}
                        >
                          <SearchHighlight text={number.e164} search={search} />
                        </Link>
                        <CopyAction value={number.e164} />
                      </Stack>
                    </TableCell>
                    {columns.includes("status") && (
                      <TableCell>
                        <StatusBadge status={number.status} />
                      </TableCell>
                    )}
                    {columns.includes("carrier") && (
                      <TableCell sx={{ textTransform: "capitalize" }}>
                        {number.carrier ?? "—"}
                      </TableCell>
                    )}
                    {columns.includes("customer") && (
                      <TableCell>
                        <SearchHighlight
                          text={number.customerName ?? "Unassigned"}
                          search={customer}
                        />
                      </TableCell>
                    )}
                    {columns.includes("updated") && (
                      <TableCell sx={{ color: "text.secondary", fontSize: 11 }}>
                        {new Date(number.updatedAt).toLocaleString()}
                      </TableCell>
                    )}
                    <TableCell align="right">
                      <Tooltip title="Preview number">
                        <IconButton
                          aria-label={`Preview ${number.e164}`}
                          onClick={() => setPreview(number.id)}
                          size="small"
                        >
                          <Icon name="chevron" sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {canAssign && (
            <Button
              sx={{ m: 2 }}
              disabled={selected.length === 0}
              onClick={() => {
                setBulkError("");
                setBulkOpen(true);
              }}
            >
              Assign selected ({selected.length})
            </Button>
          )}
          {numbers.data.items.length === 0 && (
            <Typography sx={{ p: 2 }}>
              No numbers match these filters.
            </Typography>
          )}
          <Stack
            direction="row"
            spacing={1}
            sx={{ p: 2, alignItems: "center" }}
          >
            <Typography sx={{ flexGrow: 1 }}>
              {numbers.data.total} numbers · page {page}
            </Typography>
            <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button
              disabled={page * numbers.data.pageSize >= numbers.data.total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </Stack>
        </Paper>
      )}
      {user?.permissions.includes("sync.trigger") && carriers.data && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6">Carrier synchronization</Typography>
          {carriers.data.flatMap((item) =>
            item.accounts.map((account) => (
              <Stack
                key={account.id}
                direction={{ xs: "column", sm: "row" }}
                spacing={2}
                sx={{ mt: 1, alignItems: "center" }}
              >
                <Typography sx={{ flexGrow: 1 }}>
                  {item.displayName} · {account.externalAccountId} ·{" "}
                  {account.lastSync
                    ? `Latest sync ${account.lastSync.status} (${new Date(account.lastSync.startedAt).toLocaleString()}) · ${account.lastSync.seen} seen · ${account.lastSync.issues} issues${account.lastSync.errorCode ? ` · ${account.lastSync.errorCode}` : ""}`
                    : "Not yet synced"}
                </Typography>
                <Button
                  disabled={
                    !item.capabilities.includes("inventory.list") ||
                    account.status !== "active"
                  }
                  onClick={() => void sync(account.id)}
                >
                  Sync now
                </Button>
              </Stack>
            )),
          )}
        </Paper>
      )}
      {issues.data && issues.data.length > 0 && (
        <Alert severity="warning">
          {issues.data.length} open reconciliation issues need review.
        </Alert>
      )}
      <NumberPreview id={preview} onClose={() => setPreview(null)} />
      <Dialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Assign {selected.length} selected numbers</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Find customer"
              value={customerSearch}
              onChange={(event) => setCustomerSearch(event.target.value)}
            />
            <FormControl fullWidth>
              <InputLabel htmlFor="bulk-customer">Customer</InputLabel>
              <Select
                native
                label="Customer"
                inputProps={{ id: "bulk-customer", "aria-label": "Customer" }}
                value={selectedCustomer}
                onChange={(event) =>
                  setSelectedCustomer(String(event.target.value))
                }
              >
                <option value="">Select a customer</option>
                {customers.data?.items
                  .filter((item) => item.status === "active")
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </Select>
            </FormControl>
            {bulkError && <Alert severity="error">{bulkError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!selectedCustomer || bulkSaving}
            onClick={() => void bulkAssign()}
          >
            Confirm bulk assignment
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
