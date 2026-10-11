import {
  Alert,
  Button,
  CircularProgress,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { authorizedFetch, getJson } from "../shared/api/client";
import { PageHeader } from "../shared/ui/page-header";

const options = [
  ["all-dids", "All DIDs"],
  ["by-carrier", "DIDs by carrier"],
  ["by-customer", "DIDs by customer"],
  ["unassigned", "Unassigned DIDs"],
  ["assignment-history", "Assignment history"],
  ["purchase-history", "Purchase history"],
  ["open-ports", "Open ports"],
  ["sync-failures", "Synchronization failures"],
] as const;
interface Report {
  type: string;
  columns: string[];
  rows: Array<Record<string, string>>;
  total: number;
  page: number;
  pageSize: number;
}
export function ReportsPage() {
  const { type: requested } = useParams();
  const [selected, setSelected] = useState(
    requested && options.some(([value]) => value === requested)
      ? requested
      : "all-dids",
  );
  const [search, setSearch] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const params = new URLSearchParams({ page: String(page), pageSize: "50" });
  if (submitted) params.set("search", submitted);
  const report = useQuery({
    queryKey: ["report", selected, params.toString()],
    queryFn: () => getJson<Report>(`/api/v1/reports/${selected}?${params}`),
  });
  async function download(format: "csv" | "xlsx") {
    setError("");
    try {
      const query = new URLSearchParams({ format });
      if (submitted) query.set("search", submitted);
      const response = await authorizedFetch(
        `/api/v1/reports/${selected}/export?${query}`,
      );
      if (!response.ok) throw new Error(`Export failed (${response.status})`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `dataphone-${selected}.${format}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Export failed");
    }
  }
  return (
    <Stack spacing={3}>
      <PageHeader
        title="Reports"
        description="Search operational data and export the current report."
      />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <TextField
          select
          label="Report"
          value={selected}
          onChange={(event) => {
            setSelected(event.target.value);
            setPage(1);
          }}
          sx={{ minWidth: 220 }}
        >
          {options.map(([value, label]) => (
            <MenuItem key={value} value={value}>
              {label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Search report"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setSubmitted(search.trim());
              setPage(1);
            }
          }}
        />
        <Button
          onClick={() => {
            setSubmitted(search.trim());
            setPage(1);
          }}
        >
          Search
        </Button>
        <Button onClick={() => void download("csv")}>Download CSV</Button>
        <Button onClick={() => void download("xlsx")}>Download Excel</Button>
      </Stack>
      {selected === "unassigned" && (
        <Alert severity="info">
          Unassigned carrier-held numbers are potentially unused. Billing and
          routing usage are outside this POC.
        </Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {report.isPending && <CircularProgress aria-label="Loading report" />}
      {report.isError && (
        <Alert severity="error">Could not load this report.</Alert>
      )}
      {report.data && (
        <Paper sx={{ overflowX: "auto" }}>
          <Typography sx={{ p: 2 }}>{report.data.total} result(s)</Typography>
          {report.data.rows.length === 0 ? (
            <Typography sx={{ p: 2 }}>No matching records.</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  {report.data.columns.map((column) => (
                    <TableCell key={column}>{column}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {report.data.rows.map((row, index) => (
                  <TableRow key={`${page}-${index}`}>
                    {report.data.columns.map((column) => (
                      <TableCell key={column}>{row[column] ?? ""}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Stack direction="row" spacing={1} sx={{ p: 2 }}>
            <Button
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous
            </Button>
            <Typography sx={{ alignSelf: "center" }}>Page {page}</Typography>
            <Button
              disabled={page * report.data.pageSize >= report.data.total}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </Button>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
