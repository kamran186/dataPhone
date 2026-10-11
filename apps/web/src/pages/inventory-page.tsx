import { PageHeader } from "../shared/ui/page-header";
import { EmptyState } from "../shared/ui/empty-state";

export function InventoryPage() {
  return (
    <>
      <PageHeader
        title="Inventory"
        description="Search and manage numbers across connected carriers."
      />
      <EmptyState
        title="No numbers available"
        detail="Connect a carrier account and synchronize its inventory to see numbers here."
      />
    </>
  );
}
