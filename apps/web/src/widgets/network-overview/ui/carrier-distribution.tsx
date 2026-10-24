import { Box, Paper, Stack, Typography } from "@mui/material";
import type { Dashboard } from "../../../entities/dashboard/api/types";
const chartColors = ["primary", "cyan", "violet", "success", "warning"];
const numberFormat = new Intl.NumberFormat();

export function CarrierDistribution({
  items,
}: {
  items: Dashboard["byCarrier"];
}) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  let offset = 0;
  return (
    <Paper sx={{ p: 3, height: "100%" }}>
      <Typography variant="h6">Carrier distribution</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        How your number inventory connects
      </Typography>
      {!total ? (
        <Typography color="text.secondary" sx={{ py: 5 }}>
          No carrier numbers yet.
        </Typography>
      ) : (
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={3}
          sx={{ alignItems: "center" }}
        >
          <Box
            sx={{
              position: "relative",
              width: 162,
              height: 162,
              flexShrink: 0,
            }}
          >
            <svg
              className="donut-chart"
              viewBox="0 0 160 160"
              role="img"
              aria-label={items
                .map((item) => `${item.carrier}: ${item.count}`)
                .join(", ")}
            >
              <circle className="chart-track" cx="80" cy="80" r="62" />
              {items.map((item, i) => {
                const length = (item.count / total) * 389.56;
                const start = offset;
                offset += length;
                return (
                  <circle
                    key={item.carrier}
                    className="chart-segment"
                    cx="80"
                    cy="80"
                    r="62"
                    stroke={`var(--dp-${chartColors[i % chartColors.length]})`}
                    strokeDasharray={`${length} ${389.56 - length}`}
                    strokeDashoffset={-start}
                  />
                );
              })}
            </svg>
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "grid",
                alignContent: "center",
                textAlign: "center",
              }}
            >
              <Typography
                sx={{ fontSize: 28, fontWeight: 650, letterSpacing: "-.05em" }}
              >
                {numberFormat.format(total)}
              </Typography>
              <Typography sx={{ fontSize: 10, color: "text.secondary" }}>
                TOTAL NUMBERS
              </Typography>
            </Box>
          </Box>
          <Stack spacing={1.5} sx={{ flex: 1, width: "100%" }}>
            {items.map((item, i) => (
              <Stack
                direction="row"
                spacing={1}
                key={item.carrier}
                sx={{ alignItems: "center" }}
              >
                <Box
                  sx={{
                    height: 7,
                    width: 7,
                    borderRadius: "50%",
                    bgcolor: `var(--dp-${chartColors[i % chartColors.length]})`,
                  }}
                />
                <Typography
                  variant="body2"
                  sx={{ textTransform: "capitalize", flex: 1 }}
                >
                  {item.carrier}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 650, fontVariantNumeric: "tabular-nums" }}
                >
                  {numberFormat.format(item.count)}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ minWidth: 35, textAlign: "right" }}
                >
                  {Math.round((item.count / total) * 100)}%
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Stack>
      )}
    </Paper>
  );
}
