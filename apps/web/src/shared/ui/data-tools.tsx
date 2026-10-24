import {
  Alert,
  Box,
  IconButton,
  Snackbar,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from "@mui/material";
import { useState } from "react";
import { Icon } from "./icon";

export function CopyAction({ value }: { value: string }) {
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  return (
    <>
      <Tooltip title="Copy number">
        <IconButton
          size="small"
          aria-label={`Copy ${value}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setFailed(false);
              setMessage("Number copied to clipboard");
            } catch {
              setFailed(true);
              setMessage(
                "Clipboard unavailable. Select the number to copy it manually.",
              );
            }
          }}
        >
          <Icon name="copy" sx={{ fontSize: 15 }} />
        </IconButton>
      </Tooltip>
      <Snackbar
        open={Boolean(message)}
        autoHideDuration={3500}
        onClose={() => setMessage("")}
      >
        <Alert
          severity={failed ? "warning" : "success"}
          onClose={() => setMessage("")}
        >
          {message}
        </Alert>
      </Snackbar>
    </>
  );
}

export function SearchHighlight({
  text,
  search,
}: {
  text: string;
  search: string;
}) {
  const start = search ? text.toLowerCase().indexOf(search.toLowerCase()) : -1;
  if (start < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, start)}
      <Box
        component="mark"
        sx={{
          bgcolor: "var(--dp-glow)",
          color: "text.primary",
          borderRadius: 0.5,
        }}
      >
        {text.slice(start, start + search.length)}
      </Box>
      {text.slice(start + search.length)}
    </>
  );
}

export function DensityControl({
  compact,
  onChange,
}: {
  compact: boolean;
  onChange: (compact: boolean) => void;
}) {
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={compact ? "compact" : "comfortable"}
      onChange={(_, value: string | null) => {
        if (value) onChange(value === "compact");
      }}
      aria-label="Table density"
    >
      <ToggleButton
        value="comfortable"
        sx={{ px: 1.5, py: 0.5, fontSize: 11, textTransform: "none" }}
      >
        Comfortable
      </ToggleButton>
      <ToggleButton
        value="compact"
        sx={{ px: 1.5, py: 0.5, fontSize: 11, textTransform: "none" }}
      >
        Compact
      </ToggleButton>
    </ToggleButtonGroup>
  );
}
