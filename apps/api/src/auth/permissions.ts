export const permissions = [
  "users.manage",
  "roles.manage",
  "carriers.configure",
  "inventory.view",
  "inventory.manage",
  "customers.view",
  "customers.manage",
  "numbers.assign",
  "numbers.purchase",
  "numbers.disconnect",
  "ports.manage",
  "sync.trigger",
  "jobs.view",
  "audit.view",
  "reports.view",
] as const;

export type Permission = (typeof permissions)[number];

export const initialRoles: ReadonlyArray<{
  key: string;
  name: string;
  permissions: readonly Permission[];
}> = [
  {
    key: "SUPER_ADMIN",
    name: "Super Admin",
    permissions,
  },
  {
    key: "OPERATIONS_MANAGER",
    name: "Operations Manager",
    permissions: permissions.filter(
      (permission) =>
        !["users.manage", "roles.manage", "carriers.configure"].includes(
          permission,
        ),
    ),
  },
  {
    key: "OPERATIONS_STAFF",
    name: "Operations Staff",
    permissions: [
      "inventory.view",
      "customers.view",
      "numbers.assign",
      "numbers.purchase",
      "ports.manage",
      "audit.view",
      "jobs.view",
      "reports.view",
    ],
  },
  {
    key: "VIEWER",
    name: "Viewer",
    permissions: [
      "inventory.view",
      "customers.view",
      "audit.view",
      "reports.view",
    ],
  },
];

export function permissionsForRoles(roleKeys: readonly string[]): Permission[] {
  return [
    ...new Set(
      initialRoles
        .filter((role) => roleKeys.includes(role.key))
        .flatMap((role) => role.permissions),
    ),
  ];
}
