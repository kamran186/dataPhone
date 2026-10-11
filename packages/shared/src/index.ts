export const roles = [
  "SUPER_ADMIN",
  "OPERATIONS_MANAGER",
  "OPERATIONS_STAFF",
  "VIEWER",
] as const;
export type Role = (typeof roles)[number];

export interface ApiError {
  statusCode: number;
  message: string;
  correlationId: string;
}
