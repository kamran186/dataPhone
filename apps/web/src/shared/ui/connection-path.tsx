import { Box, Stack, Typography } from "@mui/material";
import { Icon } from "./icon";
export function ConnectionPath({
  source,
  destination,
  caption,
}: {
  source: string;
  destination: string;
  caption: string;
}) {
  return (
    <Box sx={{ p: 2.5, bgcolor: "var(--dp-raised)", borderRadius: 2 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", mb: 2 }}
      >
        {caption}
      </Typography>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Icon
            name="carrier"
            sx={{ fontSize: 18, color: "primary.main", mb: 0.5 }}
          />
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, overflowWrap: "anywhere" }}
          >
            {source}
          </Typography>
        </Box>
        <div className="transfer-line" />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Icon
            name="customers"
            sx={{ fontSize: 18, color: "secondary.main", mb: 0.5 }}
          />
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, overflowWrap: "anywhere" }}
          >
            {destination}
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
}
