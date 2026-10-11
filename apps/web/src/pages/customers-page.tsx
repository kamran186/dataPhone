import { PageHeader } from "../shared/ui/page-header";
import { EmptyState } from "../shared/ui/empty-state";

export function CustomersPage() {
  return (
    <>
      <PageHeader
        title="Customers"
        description="Manage customer records and assigned numbers."
      />
      <EmptyState
        title="No customers available"
        detail="Customer records will appear here after they are added."
      />
    </>
  );
}
