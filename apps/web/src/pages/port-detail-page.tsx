import {
  Alert,
  Button,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { subscribeJobEvents } from "../entities/jobs/api/job-stream";
import { authorizedFetch, getJson } from "../shared/api/client";

interface Port {
  id: string;
  status: string;
  numbers: string[];
  currentProvider: string;
  accountName: string;
  focDate?: string;
  rejectionReason?: string;
  nativeStatus?: string;
  jobId?: string;
  unfulfilledCount?: number;
  carrierAccountId?: string;
  history: Array<{ id: string; type: string; createdAt: string }>;
}
interface Document {
  id: string;
  filename: string;
  byteLength: number;
  createdAt: string;
}
interface Carrier {
  code: string;
  accounts: Array<{ id: string }>;
}
function label(status: string) {
  return status
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (char) => char.toUpperCase());
}
async function request(path: string, method: string, body?: unknown) {
  const response = await authorizedFetch(path, {
    method,
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<Port>;
}
export function PortDetailPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState("");
  const [correction, setCorrection] = useState({
    currentProvider: "",
    accountName: "",
    accountNumber: "",
    pin: "",
  });
  const port = useQuery({
    queryKey: ["port", id],
    enabled: Boolean(id),
    queryFn: () => getJson<Port>(`/api/v1/ports/${id}`),
  });
  const documents = useQuery({
    queryKey: ["port-documents", id],
    enabled: Boolean(id),
    queryFn: () => getJson<Document[]>(`/api/v1/ports/${id}/documents`),
  });
  const carriers = useQuery({
    queryKey: ["port-detail-carriers"],
    enabled: Boolean(port.data?.carrierAccountId),
    queryFn: () => getJson<Carrier[]>("/api/v1/carriers"),
  });
  const carrier = carriers.data?.find((item) =>
    item.accounts.some((account) => account.id === port.data?.carrierAccountId),
  );
  useEffect(() => {
    if (!port.data?.jobId) return;
    const controller = new AbortController();
    void subscribeJobEvents(
      port.data.jobId,
      (event) => {
        setProgress(
          `${event.type}${event.progress === undefined ? "" : ` · ${event.progress}%`}${event.message ? ` · ${event.message}` : ""}`,
        );
        if (event.type === "succeeded" || event.type === "failed")
          void queryClient.invalidateQueries({ queryKey: ["port", id] });
      },
      controller.signal,
    );
    return () => controller.abort();
  }, [id, port.data?.jobId, queryClient]);
  async function act(action: string) {
    setError("");
    setNotice("");
    try {
      await request(`/api/v1/ports/${id}/${action}`, "POST");
      setNotice(`Port request ${action} accepted.`);
      await queryClient.invalidateQueries({ queryKey: ["port", id] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed");
    }
  }
  async function correct() {
    setError("");
    const changes = Object.fromEntries(
      Object.entries(correction).filter(([, value]) => value.trim()),
    );
    if (!Object.keys(changes).length) {
      setError("Enter a correction first.");
      return;
    }
    try {
      await request(`/api/v1/ports/${id}`, "PATCH", changes);
      setCorrection({
        currentProvider: "",
        accountName: "",
        accountNumber: "",
        pin: "",
      });
      setNotice("Correction saved.");
      await queryClient.invalidateQueries({ queryKey: ["port", id] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Correction failed");
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Document must be 5 MB or smaller.");
      return;
    }
    setError("");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let raw = "";
      for (const byte of bytes) raw += String.fromCharCode(byte);
      const response = await authorizedFetch(`/api/v1/ports/${id}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          base64: btoa(raw),
        }),
      });
      if (!response.ok) throw new Error(`Upload failed (${response.status})`);
      setNotice("Document uploaded.");
      await queryClient.invalidateQueries({ queryKey: ["port-documents", id] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed");
    }
  }
  async function download(document: Document) {
    setError("");
    try {
      const response = await authorizedFetch(
        `/api/v1/ports/${id}/documents/${document.id}`,
      );
      if (!response.ok) throw new Error(`Download failed (${response.status})`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = document.filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Download failed");
    }
  }
  return (
    <Stack spacing={3}>
      <Button component={Link} to="/ports" sx={{ alignSelf: "flex-start" }}>
        Back to ports
      </Button>
      <Typography variant="h4" component="h1">
        Port request
      </Typography>
      {port.isPending && <CircularProgress aria-label="Loading port request" />}
      {port.isError && (
        <Alert severity="error">Could not load port request.</Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert severity="success">{notice}</Alert>}
      {progress && <Alert severity="info">Job progress: {progress}</Alert>}
      {port.data && (
        <>
          <Paper sx={{ p: 3 }}>
            <Stack spacing={1}>
              <Typography variant="h6">
                {port.data.numbers.join(", ")}
              </Typography>
              <Typography>Status: {label(port.data.status)}</Typography>
              <Typography>
                Current provider: {port.data.currentProvider}
              </Typography>
              <Typography>Account name: {port.data.accountName}</Typography>
              {port.data.nativeStatus && (
                <Typography>
                  Carrier status: {port.data.nativeStatus}
                </Typography>
              )}
              {port.data.focDate && (
                <Alert severity="info">
                  Date confirmed:{" "}
                  {new Date(port.data.focDate).toLocaleDateString()}. Port is
                  still in progress.
                </Alert>
              )}
              {port.data.rejectionReason && (
                <Alert severity="warning">
                  Rejected: {port.data.rejectionReason}
                </Alert>
              )}
              {port.data.unfulfilledCount ? (
                <Alert severity="warning">
                  {port.data.unfulfilledCount} number(s) still need completion.
                </Alert>
              ) : null}
              {port.data.status === "DRAFT" && (
                <Button
                  variant="contained"
                  disabled={carrier?.code !== "mock"}
                  onClick={() => void act("submit")}
                >
                  Submit mock port
                </Button>
              )}
              {port.data.status === "REJECTED" && (
                <Button
                  variant="contained"
                  disabled={carrier?.code !== "mock"}
                  onClick={() => void act("resubmit")}
                >
                  Resubmit mock port
                </Button>
              )}
              {(port.data.status === "DRAFT" ||
                port.data.status === "REJECTED") && (
                <Button color="error" onClick={() => void act("cancel")}>
                  Cancel request
                </Button>
              )}
              {carrier?.code !== "mock" &&
                (port.data.status === "DRAFT" ||
                  port.data.status === "REJECTED") && (
                  <Alert severity="info">
                    Live carrier port submission is disabled.
                  </Alert>
                )}
            </Stack>
          </Paper>
          {(port.data.status === "DRAFT" ||
            port.data.status === "REJECTED") && (
            <Paper sx={{ p: 3 }}>
              <Stack spacing={2}>
                <Typography variant="h6">Correct details</Typography>
                {(
                  [
                    ["currentProvider", "Current provider"],
                    ["accountName", "Account name"],
                    ["accountNumber", "New account number"],
                    ["pin", "New account PIN"],
                  ] as Array<[keyof typeof correction, string]>
                ).map(([key, title]) => (
                  <TextField
                    key={key}
                    label={title}
                    value={correction[key]}
                    type={
                      key === "pin" || key === "accountNumber"
                        ? "password"
                        : "text"
                    }
                    onChange={(event) =>
                      setCorrection((before) => ({
                        ...before,
                        [key]: event.target.value,
                      }))
                    }
                  />
                ))}
                <Button onClick={() => void correct()}>Save correction</Button>
              </Stack>
            </Paper>
          )}
          <Paper sx={{ p: 3 }}>
            <Stack spacing={2}>
              <Typography variant="h6">Documents</Typography>
              <Button component="label">
                Upload PDF or image
                <input
                  hidden
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  onChange={(event) => void upload(event.target.files?.[0])}
                />
              </Button>
              {documents.isPending && (
                <CircularProgress aria-label="Loading documents" />
              )}
              {documents.isError && (
                <Alert severity="error">Could not load documents.</Alert>
              )}
              {documents.data?.length === 0 && (
                <Typography>No documents uploaded.</Typography>
              )}
              {documents.data?.map((document) => (
                <Button
                  key={document.id}
                  onClick={() => void download(document)}
                >
                  {document.filename} · {Math.ceil(document.byteLength / 1024)}{" "}
                  KB
                </Button>
              ))}
            </Stack>
          </Paper>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6">History</Typography>
            <Stack spacing={1} sx={{ mt: 1 }}>
              {port.data.history?.map((event) => (
                <Typography key={event.id}>
                  {new Date(event.createdAt).toLocaleString()} ·{" "}
                  {event.type.replaceAll(".", " ")}
                </Typography>
              ))}
            </Stack>
          </Paper>
        </>
      )}
    </Stack>
  );
}
