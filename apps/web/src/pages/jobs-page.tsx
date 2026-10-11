import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  subscribeJobEvents,
  type JobProgressEvent,
} from "../entities/jobs/api/job-stream";
import { getJson } from "../shared/api/client";

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
    queryFn: () => getJson<{ items: JobSummary[] }>("/api/v1/jobs"),
  });
  const [selected, setSelected] = useState<string>();
  const [events, setEvents] = useState<JobProgressEvent[]>([]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setEvents([]);
    void subscribeJobEvents(
      selected,
      (event) => {
        setEvents((previous) => [...previous.slice(-49), event]);
        void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      },
      controller.signal,
    );
    return () => controller.abort();
  }, [selected, queryClient]);

  const active = jobs.data?.items.find((job) => job.id === selected);
  return (
    <Stack spacing={2}>
      <Typography variant="h4" component="h1">
        Background jobs
      </Typography>
      <Typography color="text.secondary">
        Recent processing activity and live progress.
      </Typography>
      {jobs.isPending && <CircularProgress aria-label="Loading jobs" />}
      {jobs.isError && <Alert severity="error">Unable to load jobs.</Alert>}
      {jobs.data && jobs.data.items.length === 0 && (
        <Alert severity="info">No jobs have been created.</Alert>
      )}
      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        <Paper sx={{ flex: 1 }}>
          <List aria-label="Recent jobs">
            {jobs.data?.items.map((job) => (
              <ListItemButton
                key={job.id}
                selected={selected === job.id}
                onClick={() => setSelected(job.id)}
              >
                <ListItemText
                  primary={job.type}
                  secondary={`${job.progress}% · ${new Date(job.createdAt).toLocaleString()}`}
                />
                <Chip size="small" label={job.status} />
              </ListItemButton>
            ))}
          </List>
        </Paper>
        {active && (
          <Paper sx={{ flex: 1, p: 2 }}>
            <Stack spacing={1}>
              <Typography variant="h6">{active.type}</Typography>
              <Typography>Progress: {active.progress}%</Typography>
              <Typography>
                Attempts: {active.attempts} of {active.maxAttempts}
              </Typography>
              {active.failure && (
                <Alert severity="error">
                  {active.failure.message} ({active.failure.code})
                </Alert>
              )}
              <Typography variant="subtitle2">Events</Typography>
              <Box component="ol" sx={{ pl: 3, m: 0 }}>
                {events.map((event, index) => (
                  <li key={`${event.createdAt}-${index}`}>
                    {event.type}
                    {event.progress === undefined
                      ? ""
                      : ` · ${event.progress}%`}
                    {event.message ? ` · ${event.message}` : ""}
                  </li>
                ))}
              </Box>
            </Stack>
          </Paper>
        )}
      </Stack>
    </Stack>
  );
}
