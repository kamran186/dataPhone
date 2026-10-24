import { Box, Chip } from "@mui/material";

export function StatusBadge({ status }: { status: string }) {
  const value = status.toLowerCase();
  const tone = [
    "active",
    "succeeded",
    "completed",
    "confirmed",
    "connected",
  ].includes(value)
    ? "success"
    : ["failed", "rejected", "disconnected", "missing"].includes(value)
      ? "danger"
      : [
            "queued",
            "running",
            "started",
            "submitted",
            "retry",
            "date_confirmed",
            "pending",
          ].includes(value)
        ? "primary"
        : "muted";
  return (
    <Chip
      size="small"
      label={value.replaceAll("_", " ")}
      icon={
        <Box
          component="span"
          sx={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            bgcolor: `var(--dp-${tone})`,
            ml: "9px !important",
          }}
        />
      }
      sx={{
        color: `var(--dp-${tone})`,
        bgcolor: `color-mix(in srgb, var(--dp-${tone}) 10%, transparent)`,
        border: `1px solid color-mix(in srgb, var(--dp-${tone}) 18%, transparent)`,
      }}
    />
  );
}
