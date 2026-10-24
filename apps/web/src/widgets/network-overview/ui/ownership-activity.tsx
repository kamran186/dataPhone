import {
  Alert,
  Box,
  Button,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getJson } from "../../../shared/api/client";
import { Icon } from "../../../shared/ui/icon";
import { StatusBadge } from "../../../shared/ui/status-badge";
interface OwnershipReport {
  rows: Array<Record<string, string>>;
  total: number;
}
export function OwnershipActivity() {
  const report = useQuery({
    queryKey: ["ownership-overview"],
    refetchInterval: 30_000,
    queryFn: () =>
      getJson<OwnershipReport>(
        "/api/v1/reports/assignment-history?page=1&pageSize=100",
      ),
  });
  const rows = [...(report.data?.rows ?? [])]
    .sort((a, b) => Date.parse(b["Started at"]) - Date.parse(a["Started at"]))
    .slice(0, 4);
  return (
    <Paper sx={{ p: 3 }}>
      <Stack
        direction="row"
        sx={{
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          mb: 2,
        }}
      >
        <Box>
          <Typography variant="h6">Ownership activity</Typography>
          <Typography variant="body2" color="text.secondary">
            {report.data && report.data.total > 100
              ? "A snapshot of the first 100 ownership records"
              : "Recent recorded customer assignments"}
          </Typography>
        </Box>
        <Button
          component={Link}
          to="/reports/assignment-history"
          endIcon={<Icon name="arrow" sx={{ fontSize: 14 }} />}
        >
          Full history
        </Button>
      </Stack>
      {report.isPending && <Skeleton height={80} />}
      {report.isError && (
        <Alert severity="warning">Ownership history is unavailable.</Alert>
      )}
      {report.data && !rows.length && (
        <Typography variant="body2" color="text.secondary">
          No customer assignments recorded yet.
        </Typography>
      )}
      {rows.map((row, index) => (
        <Stack
          key={index}
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{
            py: 1.5,
            borderTop: "1px solid",
            borderColor: "divider",
            alignItems: { sm: "center" },
          }}
        >
          <Icon name="movement" sx={{ fontSize: 17, color: "primary.main" }} />
          <Box sx={{ flex: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {row.Number}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {row.Customer}
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary">
            {row["Started at"]
              ? new Date(row["Started at"]).toLocaleString()
              : "Date unavailable"}
          </Typography>
          <StatusBadge status={row.Active === "Yes" ? "active" : "ended"} />
        </Stack>
      ))}
    </Paper>
  );
}
