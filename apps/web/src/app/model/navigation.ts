import type { IconName } from "../../shared/ui/icon";
import type { ModuleIdentity } from "../../shared/ui/module-background";
interface Destination {
  to: string;
  label: string;
  icon: IconName;
  permission: string | null;
  group: "Workspace" | "Operations" | "Administration";
  module: ModuleIdentity;
  description: string;
}
export const destinations: Destination[] = [
  {
    to: "/",
    label: "Overview",
    icon: "overview",
    permission: null,
    group: "Workspace",
    module: "dashboard",
    description: "Your network at a glance",
  },
  {
    to: "/inventory",
    label: "DID inventory",
    icon: "numbers",
    permission: "inventory.view",
    group: "Workspace",
    module: "inventory",
    description: "Numbers across connected carriers",
  },
  {
    to: "/carriers",
    label: "Carriers",
    icon: "carrier",
    permission: "inventory.view",
    group: "Workspace",
    module: "carriers",
    description: "Connected infrastructure and synchronization",
  },
  {
    to: "/customers",
    label: "Customers",
    icon: "customers",
    permission: "customers.view",
    group: "Workspace",
    module: "customers",
    description: "Customer records and number ownership",
  },
  {
    to: "/search",
    label: "Number lookup",
    icon: "search",
    permission: "inventory.view",
    group: "Operations",
    module: "lookup",
    description: "Discover available carrier numbers",
  },
  {
    to: "/purchases",
    label: "Purchases",
    icon: "purchase",
    permission: "numbers.purchase",
    group: "Operations",
    module: "purchases",
    description: "Compare offers and track orders",
  },
  {
    to: "/ports",
    label: "Port-in requests",
    icon: "ports",
    permission: "ports.manage",
    group: "Operations",
    module: "ports",
    description: "Coordinate network transitions",
  },
  {
    to: "/jobs",
    label: "Background jobs",
    icon: "jobs",
    permission: "jobs.view",
    group: "Operations",
    module: "jobs",
    description: "Follow real-time processing",
  },
  {
    to: "/reports",
    label: "Reports",
    icon: "reports",
    permission: "reports.view",
    group: "Administration",
    module: "reports",
    description: "Explore and export operational data",
  },
  {
    to: "/users",
    label: "Team & access",
    icon: "shield",
    permission: "users.manage",
    group: "Administration",
    module: "users",
    description: "Manage staff and role permissions",
  },
];
export function destinationForPath(path: string) {
  return (
    destinations.find(
      (item) =>
        item.to !== "/" && (path === item.to || path.startsWith(`${item.to}/`)),
    ) ?? destinations[0]
  );
}
