import {
  Alert,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { getJson } from "../shared/api/client";

interface NumberDetail {
  e164: string;
  status: string;
  carrier?: string;
  carrierAccount?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  holdings: Array<{ status: string; startedAt: string; endedAt?: string }>;
  assignments: Array<{ customerId: string; active: boolean }>;
}

export function NumberDetailPage() {
  const { id } = useParams();
  const detail = useQuery({
    queryKey: ["number", id],
    enabled: Boolean(id),
    queryFn: () => getJson<NumberDetail>(`/api/v1/numbers/${id}`),
  });
  return (
    <Stack spacing={2}>
      <Link to="/inventory">Back to inventory</Link>
      {detail.isPending && <CircularProgress aria-label="Loading number" />}
      {detail.isError && (
        <Alert severity="error">Unable to load this number.</Alert>
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
            </Paper>
          ))}
        </>
      )}
    </Stack>
  );
}
