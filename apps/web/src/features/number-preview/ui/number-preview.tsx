import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getJson } from "../../../shared/api/client";
import { CopyAction } from "../../../shared/ui/data-tools";
import { Icon } from "../../../shared/ui/icon";
import { StatusBadge } from "../../../shared/ui/status-badge";
interface Preview {
  e164: string;
  status: string;
  carrier?: string;
  carrierAccount?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  assignments: Array<{ customerId: string; active: boolean }>;
}
export function NumberPreview({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const detail = useQuery({
    queryKey: ["number", id],
    enabled: Boolean(id),
    queryFn: () => getJson<Preview>(`/api/v1/numbers/${id}`),
  });
  return (
    <Dialog
      open={Boolean(id)}
      onClose={onClose}
      maxWidth="xs"
      aria-labelledby="preview-title"
      slotProps={{
        paper: {
          sx: {
            position: "fixed",
            right: 0,
            top: 0,
            bottom: 0,
            m: 0,
            maxHeight: "100%",
            height: "100%",
            borderRadius: "16px 0 0 16px",
            maxWidth: 440,
          },
        },
      }}
    >
      <DialogTitle
        id="preview-title"
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        Number details
        <IconButton aria-label="Close number details" onClick={onClose}>
          <Icon name="close" fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {detail.isPending && <Skeleton variant="rounded" height={200} />}
        {detail.isError && (
          <Alert severity="error">Unable to load number details.</Alert>
        )}
        {detail.data && (
          <Stack spacing={3}>
            <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
              <Typography variant="h5">{detail.data.e164}</Typography>
              <CopyAction value={detail.data.e164} />
            </Stack>
            <Box>
              <StatusBadge status={detail.data.status} />
            </Box>
            {[
              ["Carrier", detail.data.carrier ?? "Unknown"],
              ["Account", detail.data.carrierAccount ?? "Unknown"],
              [
                "Assignment",
                detail.data.assignments.some((item) => item.active)
                  ? "Assigned to customer"
                  : "Unassigned",
              ],
              [
                "First seen",
                new Date(detail.data.firstSeenAt).toLocaleString(),
              ],
              ["Last seen", new Date(detail.data.lastSeenAt).toLocaleString()],
            ].map(([label, value]) => (
              <Box key={label}>
                <Typography variant="caption" color="text.secondary">
                  {label}
                </Typography>
                <Typography variant="body2">{value}</Typography>
              </Box>
            ))}
            <Button
              component={Link}
              to={`/inventory/${id}`}
              variant="contained"
              onClick={onClose}
              endIcon={<Icon name="arrow" fontSize="small" />}
            >
              Open full history & actions
            </Button>
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}
