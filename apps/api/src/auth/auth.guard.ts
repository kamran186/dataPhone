import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { AuthService, AuthenticatedUser } from "./auth.service";
import { PUBLIC_ROUTE } from "./auth.decorators";

export type AuthRequest = Request & { authUser?: AuthenticatedUser };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const match = /^Bearer (\S+)$/.exec(request.header("authorization") ?? "");
    if (!match) throw new UnauthorizedException("Access token required");
    request.authUser = await this.auth.authenticate(match[1]);
    return true;
  }
}
