import { Paper, Typography } from "@mui/material";

interface EmptyStateProps {
  title: string;
  detail: string;
}

export function EmptyState({ title, detail }: EmptyStateProps) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: 5, textAlign: "center", borderRadius: 3 }}
    >
      <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
        {title}
      </Typography>
      <Typography color="text.secondary">{detail}</Typography>
    </Paper>
  );
}
