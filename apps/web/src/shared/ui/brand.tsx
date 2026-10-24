import { Stack, Typography } from "@mui/material";
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Stack
      direction="row"
      spacing={1.2}
      aria-label="DataPhone"
      sx={{ alignItems: "center" }}
    >
      <span className="brand-mark">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M6 5h5a7 7 0 0 1 0 14H6V5Z"
            stroke="currentColor"
            strokeWidth="2.2"
          />
          <path
            d="M6 12h13M10 8v8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </span>
      {!compact && (
        <Typography
          component="span"
          sx={{ fontSize: 20, fontWeight: 700, letterSpacing: "-.055em" }}
        >
          data<span style={{ fontWeight: 400 }}>phone</span>
          <span style={{ color: "var(--dp-primary)" }}>.</span>
        </Typography>
      )}
    </Stack>
  );
}
