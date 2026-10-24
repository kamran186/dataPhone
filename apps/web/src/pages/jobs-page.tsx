import {
  Alert,
  Box,
  Button,
  LinearProgress,
  List,
  ListItemButton,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  subscribeJobEvents,
  type JobProgressEvent,
  type JobStreamState,
} from "../entities/jobs/api/job-stream";
import { getJson } from "../shared/api/client";
import { Icon } from "../shared/ui/icon";
import { PageHeader } from "../shared/ui/page-header";
import { StatusBadge } from "../shared/ui/status-badge";
interface JobSummary {
  id: string;
  type: string;
  status: string;
  progress: number;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  failure?: { code: string; message: string };
}
export function JobsPage() {
  const queryClient = useQueryClient();
  const jobs = useQuery({
    queryKey: ["jobs"],
    refetchInterval: 5_000,
    queryFn: () => getJson<{ items: JobSummary[] }>("/api/v1/jobs"),
  });
  const [selected, setSelected] = useState<string>();
  const [events, setEvents] = useState<JobProgressEvent[]>([]);
  const [connection, setConnection] = useState<JobStreamState>("connecting");
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setEvents([]);
    void subscribeJobEvents(
      selected,
      (event) => {
        setEvents((previous) => [...previous.slice(-49), event]);
        if (event.type === "succeeded" || event.type === "failed")
          void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      },
      controller.signal,
      setConnection,
    );
    return () => controller.abort();
  }, [selected, queryClient]);
  const active = jobs.data?.items?.find((job) => job.id === selected);
  const latest = events.filter((event) => event.jobId === selected).at(-1);
  const status =
    latest &&
    ["succeeded", "failed", "retry", "started", "progress"].includes(
      latest.type,
    )
      ? ((
          {
            started: "running",
            progress: "running",
            retry: "retrying",
          } as Record<string, string>
        )[latest.type] ?? latest.type)
      : active?.status;
  const progress = latest?.progress ?? active?.progress;
  const terminal = status === "succeeded" || status === "failed";
  const items = jobs.data?.items ?? [];
  return (
    <Stack spacing={3}>
      <PageHeader
        title="Background jobs"
        description="Follow the signals. See every operation through."
        actions={
          <Button
            onClick={() => void jobs.refetch()}
            startIcon={<Icon name="refresh" sx={{ fontSize: 15 }} />}
            disabled={jobs.isFetching}
            variant="outlined"
          >
            Refresh jobs
          </Button>
        }
      />
      <Box
        sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 2 }}
      >
        {[
          {
            label: "Processing",
            count: items.filter((job) =>
              ["running", "queued", "retrying"].includes(job.status),
            ).length,
          },
          {
            label: "Succeeded",
            count: items.filter((job) => job.status === "succeeded").length,
          },
          {
            label: "Failed",
            count: items.filter((job) => job.status === "failed").length,
          },
        ].map((item) => (
          <Paper key={item.label} sx={{ p: { xs: 1.5, sm: 2.5 } }}>
            <Typography variant="body2" color="text.secondary">
              {item.label}
            </Typography>
            <Typography sx={{ fontSize: 27, fontWeight: 650, mt: 1 }}>
              {jobs.data ? item.count : "—"}
            </Typography>
          </Paper>
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary">
        Counts reflect jobs returned by the recent activity API.
      </Typography>
      {jobs.isPending && (
        <Skeleton aria-label="Loading jobs" variant="rounded" height={220} />
      )}
      {jobs.isError && <Alert severity="error">Unable to load jobs.</Alert>}
      {jobs.data && !items.length && (
        <Alert severity="info">No jobs have been created.</Alert>
      )}
      {!!items.length && (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", lg: ".85fr 1.15fr" },
            gap: 3,
            alignItems: "start",
          }}
        >
          <Paper sx={{ overflow: "hidden" }}>
            <Typography
              variant="h6"
              sx={{ p: 2.5, borderBottom: "1px solid", borderColor: "divider" }}
            >
              Recent jobs
            </Typography>
            <List
              aria-label="Recent jobs"
              sx={{ p: 1, maxHeight: 590, overflowY: "auto" }}
            >
              {items.map((job) => (
                <ListItemButton
                  key={job.id}
                  selected={selected === job.id}
                  onClick={() => setSelected(job.id)}
                  sx={{ borderRadius: 1.5, py: 2, gap: 1.5 }}
                >
                  <Icon
                    name="jobs"
                    sx={{ fontSize: 18, color: "primary.main" }}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 600, overflowWrap: "anywhere" }}
                    >
                      {job.type}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {job.progress}% ·{" "}
                      {new Date(job.createdAt).toLocaleString()}
                    </Typography>
                  </Box>
                  <StatusBadge status={job.status} />
                </ListItemButton>
              ))}
            </List>
          </Paper>
          <Paper sx={{ p: 3, minHeight: 320 }}>
            {!active ? (
              <Stack
                sx={{
                  py: 6,
                  textAlign: "center",
                  alignItems: "center",
                  gap: 1.5,
                }}
              >
                <Icon
                  name="jobs"
                  sx={{ fontSize: 32, color: "primary.main" }}
                />
                <Typography variant="h6">
                  Every operation has a story
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Select a job to inspect its progress and event history.
                </Typography>
              </Stack>
            ) : (
              <Stack spacing={2.5}>
                <Stack
                  direction="row"
                  sx={{
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 1,
                  }}
                >
                  <Typography variant="h6" sx={{ overflowWrap: "anywhere" }}>
                    {active.type}
                  </Typography>
                  <StatusBadge status={status ?? active.status} />
                </Stack>
                <Typography
                  variant="caption"
                  sx={{
                    color: "text.secondary",
                    overflowWrap: "anywhere",
                    fontFamily: "ui-monospace, monospace",
                  }}
                >
                  {active.id}
                </Typography>
                <Box>
                  <Stack
                    direction="row"
                    sx={{ justifyContent: "space-between", mb: 1 }}
                  >
                    <Typography variant="body2">Progress</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 650 }}>
                      {progress === undefined
                        ? "Awaiting update"
                        : `${progress}%`}
                    </Typography>
                  </Stack>
                  <LinearProgress
                    aria-label="Job progress"
                    variant={
                      progress === undefined ? "indeterminate" : "determinate"
                    }
                    value={Math.min(100, Math.max(0, progress ?? 0))}
                    color={
                      status === "failed"
                        ? "error"
                        : status === "succeeded"
                          ? "success"
                          : "primary"
                    }
                    sx={{ height: 6, borderRadius: 2 }}
                  />
                </Box>
                <Stack
                  direction="row"
                  sx={{ justifyContent: "space-between", gap: 1 }}
                >
                  <Typography variant="caption" color="text.secondary">
                    Attempts: {active.attempts} of {active.maxAttempts}
                  </Typography>
                  <Typography
                    variant="caption"
                    role="status"
                    color={
                      connection === "reconnecting"
                        ? "warning.main"
                        : "text.secondary"
                    }
                  >
                    {connection === "connected"
                      ? "Live stream connected"
                      : connection === "reconnecting"
                        ? "Reconnecting… progress also refreshes automatically"
                        : connection === "complete"
                          ? "Event stream complete"
                          : connection === "unavailable"
                            ? "Stream unavailable · using periodic refresh"
                            : "Connecting to event stream…"}
                  </Typography>
                </Stack>
                {active.failure && (
                  <Alert severity="error">
                    {active.failure.message} ({active.failure.code})
                  </Alert>
                )}
                {terminal && (
                  <Alert severity={status === "failed" ? "error" : "success"}>
                    {status === "succeeded"
                      ? "Processing completed successfully."
                      : "Processing failed. Review the error details and event history."}
                  </Alert>
                )}
                <Box
                  sx={{ borderTop: "1px solid", borderColor: "divider", pt: 2 }}
                >
                  <Typography variant="h6" sx={{ mb: 2 }}>
                    Execution timeline
                  </Typography>
                  {!events.length && (
                    <Typography variant="body2" color="text.secondary">
                      Waiting for persisted events. Saved job status is shown
                      above.
                    </Typography>
                  )}
                  <Box
                    component="ol"
                    aria-label="Job events"
                    sx={{
                      listStyle: "none",
                      p: 0,
                      m: 0,
                      maxHeight: 370,
                      overflowY: "auto",
                    }}
                  >
                    {events.map((event, index) => (
                      <Box
                        component="li"
                        key={`${event.createdAt}-${index}`}
                        sx={{
                          pl: 2,
                          pb: 2.5,
                          ml: 0.5,
                          borderLeft: "1px solid",
                          borderColor: "divider",
                          position: "relative",
                          "&:before": {
                            content: "''",
                            position: "absolute",
                            left: -4,
                            top: 5,
                            width: 7,
                            height: 7,
                            borderRadius: "50%",
                            bgcolor: "primary.main",
                          },
                        }}
                      >
                        <Stack
                          direction="row"
                          sx={{ justifyContent: "space-between", gap: 1 }}
                        >
                          <Typography
                            variant="body2"
                            sx={{
                              textTransform: "capitalize",
                              fontWeight: 600,
                            }}
                          >
                            {event.type}
                            {event.progress === undefined
                              ? ""
                              : ` · ${event.progress}%`}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {new Date(event.createdAt).toLocaleTimeString()}
                          </Typography>
                        </Stack>
                        {event.message && (
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ overflowWrap: "anywhere" }}
                          >
                            {event.message}
                          </Typography>
                        )}
                      </Box>
                    ))}
                  </Box>
                </Box>
              </Stack>
            )}
          </Paper>
        </Box>
      )}
    </Stack>
  );
}
