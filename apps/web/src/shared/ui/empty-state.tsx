import { Paper, Typography, Box } from "@mui/material";
import { Icon } from "./icon";
interface EmptyStateProps {
  title: string;
  detail: string;
}
export function EmptyState({ title, detail }: EmptyStateProps) {
  return (
    <Paper variant="outlined" sx={{ py: 6, px: 3, textAlign: "center" }}>
      <Box
        sx={{
          display: "grid",
          placeItems: "center",
          mx: "auto",
          mb: 2,
          width: 48,
          height: 48,
          borderRadius: 3,
          bgcolor: "var(--dp-glow)",
          color: "primary.main",
        }}
      >
        <Icon name="globe" />
      </Box>
      <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
        {title}
      </Typography>
      <Typography
        color="text.secondary"
        variant="body2"
        sx={{ maxWidth: 440, mx: "auto" }}
      >
        {detail}
      </Typography>
    </Paper>
  );
}
