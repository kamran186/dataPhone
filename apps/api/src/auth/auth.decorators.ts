import { SetMetadata } from "@nestjs/common";
import type { Permission } from "./permissions";

export const PUBLIC_ROUTE = "dataphone:public";
export const REQUIRED_PERMISSIONS = "dataphone:permissions";

export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);
