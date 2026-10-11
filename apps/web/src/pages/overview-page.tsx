import { Alert, Stack } from "@mui/material";
import { useSystemInfo } from "../entities/system/api/use-system-info";
import { PageHeader } from "../shared/ui/page-header";
import { EmptyState } from "../shared/ui/empty-state";

export function OverviewPage() {
  const system = useSystemInfo();
  return (
    <>
      <PageHeader
        title="Overview"
        description="A central place to manage DataPhone numbers and carrier activity."
      />
      <Stack spacing={3}>
        {system.isError && (
          <Alert severity="warning">
            The API is unavailable. Check the service connection.
          </Alert>
        )}
        <EmptyState
          title="No activity to show"
          detail="Inventory and operational activity will appear here when carrier accounts are connected."
        />
      </Stack>
    </>
  );
}
