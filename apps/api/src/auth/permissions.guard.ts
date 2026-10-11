import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthService } from "./auth.service";
import { AuthRequest } from "./auth.guard";
import { REQUIRED_PERMISSIONS } from "./auth.decorators";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_PERMISSIONS,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;
    const user = context.switchToHttp().getRequest<AuthRequest>().authUser;
    if (!user) return false;
    for (const permission of required)
      this.auth.requirePermission(user, permission);
    return true;
  }
}
