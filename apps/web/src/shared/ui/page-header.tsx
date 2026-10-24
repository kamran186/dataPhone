import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
interface PageHeaderProps {
  title: string;
  description: string;
  actions?: ReactNode;
}
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: { xs: "flex-start", sm: "center" },
        justifyContent: "space-between",
        flexDirection: { xs: "column", sm: "row" },
        gap: 2,
      }}
    >
      <Box>
        <Typography component="h1" variant="h4" sx={{ mb: 0.75 }}>
          {title}
        </Typography>
        <Typography color="text.secondary" sx={{ fontSize: 12 }}>
          {description}
        </Typography>
      </Box>
      {actions}
    </Box>
  );
}
