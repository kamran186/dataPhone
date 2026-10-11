import {
  Alert,
  Button,
  Checkbox,
  CircularProgress,
  FormControl,
  InputLabel,
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
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { subscribeJobEvents } from "../entities/jobs/api/job-stream";
import { authorizedFetch, getJson } from "../shared/api/client";
import { PageHeader } from "../shared/ui/page-header";

interface Offer {
  e164: string;
  nativeId: string;
  carrier: string;
  carrierName: string;
  carrierAccountId: string;
  locality?: string;
  region?: string;
  monthlyPriceCents?: number;
  setupPriceCents?: number;
  currency?: string;
}
interface Order {
  id: string;
  status: string;
  nativeIds: string[];
  customerId: string;
  items?: Array<{ e164: string; status: string }>;
  unfulfilledCount?: number;
  errorCode?: string;
  jobId: string;
}
interface Customer {
  id: string;
  name: string;
  status: string;
}

function offerKey(offer: Offer) {
  return `${offer.carrierAccountId}:${offer.nativeId}`;
}
function price(cents?: number, currency = "USD") {
  if (cents === undefined) return "Price unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    cents / 100,
  );
}

export function PurchasesPage() {
  const queryClient = useQueryClient();
  const [areaCode, setAreaCode] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [pattern, setPattern] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [lastJobId, setLastJobId] = useState("");
  const [lastOrderId, setLastOrderId] = useState("");
  const [progress, setProgress] = useState("");
  const search = useQuery({
    queryKey: ["purchase-offers", submitted],
    enabled: Boolean(submitted),
    queryFn: () =>
      getJson<{
        offers: Offer[];
        errors: Array<{ carrier: string; code: string }>;
      }>(`/api/v1/purchases/search?${submitted}`),
  });
  const customers = useQuery({
    queryKey: ["purchase-customers"],
    queryFn: () =>
      getJson<{ items: Customer[] }>("/api/v1/customers?page=1&pageSize=100"),
  });
  const orders = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: () => getJson<{ items: Order[] }>("/api/v1/purchases"),
  });
  const currentOrder = useQuery({
    queryKey: ["purchase-order", lastOrderId],
    enabled: Boolean(lastOrderId),
    queryFn: () => getJson<Order>(`/api/v1/purchases/${lastOrderId}`),
  });
  useEffect(() => {
    if (!lastJobId) return;
    const controller = new AbortController();
    void subscribeJobEvents(
      lastJobId,
      (event) => {
        setProgress(
          `${event.type}${event.progress === undefined ? "" : ` · ${event.progress}%`}${event.message ? ` · ${event.message}` : ""}`,
        );
        if (event.type === "succeeded" || event.type === "failed") {
          void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
          void queryClient.invalidateQueries({
            queryKey: ["purchase-order", lastOrderId],
          });
        }
      },
      controller.signal,
    );
    return () => controller.abort();
  }, [lastJobId, lastOrderId, queryClient]);

  const offers = search.data?.offers ?? [];
  const chosen = offers.filter((offer) => selected.includes(offerKey(offer)));
  const chosenAccount = chosen[0]?.carrierAccountId;
  const chosenCarrier = chosen[0]?.carrier;

  function runSearch() {
    setError("");
    setNotice("");
    setSelected([]);
    const params = new URLSearchParams();
    if (areaCode.trim()) params.set("areaCode", areaCode.trim());
    if (city.trim()) params.set("city", city.trim());
    if (region.trim()) params.set("region", region.trim());
    if (pattern.trim()) params.set("pattern", pattern.trim());
    if (!params.size) {
      setError("Enter an area code, city, state, or number pattern.");
      return;
    }
    setSubmitted(params.toString());
  }

  function toggle(offer: Offer) {
    const key = offerKey(offer);
    setSelected((before) =>
      before.includes(key)
        ? before.filter((item) => item !== key)
        : chosenAccount && chosenAccount !== offer.carrierAccountId
          ? [key]
          : [...before, key],
    );
  }

  async function createOrder() {
    if (
      !chosen.length ||
      !chosenAccount ||
      !customerId ||
      chosenCarrier !== "mock"
    )
      return;
    setError("");
    setNotice("");
    setCreating(true);
    try {
      const response = await authorizedFetch("/api/v1/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carrierAccountId: chosenAccount,
          customerId,
          nativeIds: chosen.map((offer) => offer.nativeId),
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      if (!response.ok)
        throw new Error(
          `Purchase order could not be created (${response.status})`,
        );
      const order = (await response.json()) as Order;
      setNotice(`Order queued: ${order.id}`);
      setSelected([]);
      setLastJobId(order.jobId);
      setLastOrderId(order.id);
      await queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Purchase order could not be created",
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Number purchases"
        description="Compare available numbers and track purchase orders."
      />
      <Alert severity="info">
        Purchase orders are available only for the mock carrier. Live billable
        purchases require separate authorization.
      </Alert>
      <Paper sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Typography variant="h6">Search available numbers</Typography>
          <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
            <TextField
              label="Area code"
              value={areaCode}
              onChange={(event) => setAreaCode(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 3 } }}
            />
            <TextField
              label="City"
              value={city}
              onChange={(event) => setCity(event.target.value)}
            />
            <TextField
              label="State"
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 2 } }}
            />
            <TextField
              label="Number pattern"
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
            />
            <Button variant="contained" onClick={runSearch}>
              Search available numbers
            </Button>
          </Stack>
        </Stack>
      </Paper>
      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert severity="success">{notice}</Alert>}
      {progress && <Alert severity="info">Order progress: {progress}</Alert>}
      {currentOrder.data && (
        <Alert
          severity={currentOrder.data.status === "failed" ? "error" : "info"}
        >
          Current order: {currentOrder.data.status} ·{" "}
          {currentOrder.data.items?.filter(
            (item) => item.status === "confirmed",
          ).length ?? 0}{" "}
          confirmed
          {currentOrder.data.unfulfilledCount
            ? ` · ${currentOrder.data.unfulfilledCount} unfulfilled`
            : ""}
        </Alert>
      )}
      {search.isPending && submitted && (
        <CircularProgress aria-label="Loading available numbers" />
      )}
      {search.isError && (
        <Alert severity="error">Unable to search available numbers.</Alert>
      )}
      {search.data?.errors.map((item) => (
        <Alert key={`${item.carrier}:${item.code}`} severity="warning">
          {item.carrier}: {item.code}
        </Alert>
      ))}
      {search.data && offers.length === 0 && (
        <Alert severity="info">No numbers matched this search.</Alert>
      )}
      {offers.length > 0 && (
        <Paper sx={{ overflowX: "auto" }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Select</TableCell>
                <TableCell>Number</TableCell>
                <TableCell>Carrier</TableCell>
                <TableCell>Location</TableCell>
                <TableCell>Monthly</TableCell>
                <TableCell>Setup</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {offers.map((offer) => (
                <TableRow key={offerKey(offer)}>
                  <TableCell>
                    <Checkbox
                      checked={selected.includes(offerKey(offer))}
                      onChange={() => toggle(offer)}
                      slotProps={{
                        input: { "aria-label": `Select ${offer.e164}` },
                      }}
                    />
                  </TableCell>
                  <TableCell>{offer.e164}</TableCell>
                  <TableCell>{offer.carrierName}</TableCell>
                  <TableCell>
                    {[offer.locality, offer.region]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </TableCell>
                  <TableCell>
                    {price(offer.monthlyPriceCents, offer.currency)}/mo
                  </TableCell>
                  <TableCell>
                    {price(offer.setupPriceCents, offer.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
      {chosen.length > 0 && (
        <Paper sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Typography variant="h6">
              Selected numbers: {chosen.length}
            </Typography>
            <Typography>
              Monthly total:{" "}
              {price(
                chosen.reduce(
                  (sum, offer) => sum + (offer.monthlyPriceCents ?? 0),
                  0,
                ),
              )}
            </Typography>
            <FormControl fullWidth>
              <InputLabel htmlFor="purchase-customer">Customer</InputLabel>
              <Select
                native
                label="Customer"
                inputProps={{
                  id: "purchase-customer",
                  "aria-label": "Customer",
                }}
                value={customerId}
                onChange={(event) => setCustomerId(String(event.target.value))}
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
            {chosenCarrier !== "mock" && (
              <Alert severity="warning">
                Live carrier purchases are disabled.
              </Alert>
            )}
            <Button
              variant="contained"
              disabled={!customerId || chosenCarrier !== "mock" || creating}
              onClick={() => void createOrder()}
            >
              Create purchase order
            </Button>
          </Stack>
        </Paper>
      )}
      <Typography variant="h6">Recent orders</Typography>
      {orders.isError && (
        <Alert severity="error">Unable to load purchase orders.</Alert>
      )}
      {orders.data?.items.length === 0 && (
        <Typography>No purchase orders yet.</Typography>
      )}
      {orders.data?.items.map((order) => (
        <Paper key={order.id} sx={{ p: 2 }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <Typography>Order {order.id}</Typography>
            <Typography>Status: {order.status}</Typography>
            <Typography>{order.nativeIds.length} requested</Typography>
            <Link to="/jobs">View job progress</Link>
          </Stack>
        </Paper>
      ))}
    </Stack>
  );
}
