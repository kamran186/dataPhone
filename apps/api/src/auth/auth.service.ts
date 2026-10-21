import { createHash, randomBytes } from "node:crypto";
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { SignJWT, jwtVerify } from "jose";
import { Id, uuid, uuidPattern } from "../database/query";
import { APP_CONFIG, AppConfig } from "../config/app-config";
import { DatabaseService } from "../database/database.service";
import { permissionsForRoles } from "./permissions";
import { hashPassword, verifyPassword } from "./password";

export interface UserDocument {
  id: Id;
  email: string;
  emailNormalized: string;
  displayName?: string;
  passwordHash: string;
  roleKeys: string[];
  active: boolean;
  tokenVersion: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName?: string;
  roleKeys: string[];
  permissions: string[];
}

interface RefreshSession {
  id: Id;
  userId: Id;
  tokenHash: string;
  expiresAt: Date;
  revokedAt?: Date;
}

const invalidCredentials = "Invalid email or password";
const accessMinutes = 15;
const refreshDays = 7;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

@Injectable()
export class AuthService {
  private readonly key: Uint8Array;
  private readonly dummyHash = hashPassword("DataPhone dummy password 2026");

  constructor(
    private readonly database: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.key = config.jwtSecret
      ? new TextEncoder().encode(config.jwtSecret)
      : randomBytes(32);
  }

  private users() {
    return this.database.sql().table<UserDocument>("users");
  }

  private sessions() {
    return this.database.sql().table<RefreshSession>("auth_sessions");
  }

  private async accessToken(user: UserDocument): Promise<string> {
    return new SignJWT({ tokenVersion: user.tokenVersion })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuer("dataphone")
      .setAudience("dataphone-api")
      .setIssuedAt()
      .setExpirationTime(`${accessMinutes}m`)
      .sign(this.key);
  }

  private async issueRefresh(user: UserDocument): Promise<string> {
    const sessionId = uuid();
    const secret = randomBytes(32).toString("base64url");
    await this.sessions().insertOne({
      id: sessionId,
      userId: user.id,
      tokenHash: digest(secret),
      expiresAt: new Date(Date.now() + refreshDays * 86_400_000),
    });
    return `${sessionId}.${secret}`;
  }

  private parseRefresh(token: string): { id: Id; secret: string } {
    const match =
      /^([a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.([A-Za-z0-9_-]{43})$/.exec(
        token,
      );
    if (!match) throw new UnauthorizedException("Invalid refresh session");
    return { id: uuid(match[1]), secret: match[2] };
  }

  private async reserveLoginAttempt(
    email: string,
    ip: string,
  ): Promise<string> {
    const key = digest(`${email}:${ip}`);
    const attempts = this.database.sql().table("login_attempts");
    await attempts.deleteOne({
      id: key as never,
      expiresAt: { $lte: new Date() },
    });
    const current = await attempts.findOneAndUpdate(
      { id: key as never },
      {
        $inc: { count: 1 },
        $setOnInsert: { expiresAt: new Date(Date.now() + 15 * 60_000) },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (Number(current?.count) > 5) {
      throw new HttpException(
        "Too many login attempts",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return key;
  }

  async login(
    email: string,
    password: string,
    ip: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    user: AuthenticatedUser;
  }> {
    await this.database.ensureReady();
    const normalized = email.trim().toLowerCase();
    const key = await this.reserveLoginAttempt(normalized, ip);
    const user = await this.database
      .sql()
      .table<UserDocument>("users")
      .findOne({ emailNormalized: normalized });
    const valid = await verifyPassword(
      password,
      user?.passwordHash ?? (await this.dummyHash),
    );
    if (!user || !user.active || !valid) {
      throw new UnauthorizedException(invalidCredentials);
    }
    await this.database
      .sql()
      .table("login_attempts")
      .deleteOne({
        id: key as never,
      });
    return {
      accessToken: await this.accessToken(user),
      refreshToken: await this.issueRefresh(user),
      user: this.toPublicUser(user),
    };
  }

  async refresh(token: string): Promise<{
    accessToken: string;
    refreshToken: string;
    user: AuthenticatedUser;
  }> {
    await this.database.ensureReady();
    const { id, secret } = this.parseRefresh(token);
    const nextSecret = randomBytes(32).toString("base64url");
    const session = await this.sessions().findOneAndUpdate(
      {
        id: id,
        tokenHash: digest(secret),
        revokedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      },
      { $set: { tokenHash: digest(nextSecret) } },
      { returnDocument: "after" },
    );
    if (!session) throw new UnauthorizedException("Invalid refresh session");
    const user = await this.database
      .sql()
      .table<UserDocument>("users")
      .findOne({ id: session.userId, active: true });
    if (!user) {
      await this.sessions().updateOne(
        { id: id },
        { $set: { revokedAt: new Date() } },
      );
      throw new UnauthorizedException("Invalid refresh session");
    }
    return {
      accessToken: await this.accessToken(user),
      refreshToken: `${id}.${nextSecret}`,
      user: this.toPublicUser(user),
    };
  }

  async authenticate(token: string): Promise<AuthenticatedUser> {
    await this.database.ensureReady();
    let subject: string | undefined;
    let tokenVersion: number | undefined;
    try {
      const verified = await jwtVerify(token, this.key, {
        algorithms: ["HS256"],
        issuer: "dataphone",
        audience: "dataphone-api",
      });
      subject = verified.payload.sub;
      tokenVersion = Number(verified.payload.tokenVersion);
    } catch {
      throw new UnauthorizedException("Invalid access token");
    }
    if (!subject || !uuidPattern.test(subject)) {
      throw new UnauthorizedException("Invalid access token");
    }
    const user = await this.database
      .sql()
      .table<UserDocument>("users")
      .findOne({ id: uuid(subject), active: true });
    if (!user || user.tokenVersion !== tokenVersion) {
      throw new UnauthorizedException("Invalid access token");
    }
    return this.toPublicUser(user);
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    await this.database.ensureReady();
    const { id, secret } = this.parseRefresh(refreshToken);
    const parsedUserId = uuid(userId);
    const result = await this.sessions().updateOne(
      {
        id: id,
        userId: parsedUserId,
        tokenHash: digest(secret),
        revokedAt: { $exists: false },
      },
      { $set: { revokedAt: new Date() } },
    );
    if (result.matchedCount !== 1) {
      throw new UnauthorizedException("Invalid refresh session");
    }
    await this.users().updateOne(
      { id: parsedUserId },
      { $inc: { tokenVersion: 1 } },
    );
  }

  private toPublicUser(user: UserDocument): AuthenticatedUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roleKeys: user.roleKeys,
      permissions: permissionsForRoles(user.roleKeys),
    };
  }

  requirePermission(user: AuthenticatedUser, permission: string): void {
    if (!user.permissions.includes(permission)) {
      throw new ForbiddenException("Permission denied");
    }
  }
}
