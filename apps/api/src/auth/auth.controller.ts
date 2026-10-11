import {
  Body,
  Controller,
  ForbiddenException,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { IsEmail, IsString } from "class-validator";
import type { Response } from "express";
import { APP_CONFIG, AppConfig } from "../config/app-config";
import { Public } from "./auth.decorators";
import { AuthRequest } from "./auth.guard";
import { AuthService } from "./auth.service";

class LoginBody {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private readCookie(request: AuthRequest): string {
    const header = request.headers.cookie ?? "";
    const value = header
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("refresh_token="));
    if (!value) throw new UnauthorizedException("Refresh session required");
    return value.slice("refresh_token=".length);
  }

  private checkOrigin(request: AuthRequest): void {
    const origin = request.header("origin");
    if (origin && origin !== this.config.corsOrigin) {
      throw new ForbiddenException("Origin denied");
    }
  }

  private setCookie(response: Response, token: string): void {
    response.cookie("refresh_token", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: this.config.environment === "production",
      path: "/api/v1/auth",
      maxAge: 7 * 86_400_000,
    });
  }

  @Public()
  @Post("login")
  async login(
    @Body() body: LoginBody,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.checkOrigin(request);
    const result = await this.auth.login(
      body.email,
      body.password,
      request.socket.remoteAddress ?? "unknown",
    );
    this.setCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Public()
  @Post("refresh")
  async refresh(
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.checkOrigin(request);
    const result = await this.auth.refresh(this.readCookie(request));
    this.setCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post("logout")
  async logout(
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.checkOrigin(request);
    await this.auth.logout(request.authUser!.id, this.readCookie(request));
    response.clearCookie("refresh_token", {
      path: "/api/v1/auth",
      sameSite: "strict",
      secure: this.config.environment === "production",
    });
    return { status: "signed_out" };
  }
}
