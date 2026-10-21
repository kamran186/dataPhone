import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Id, SqlSession, Table, uuid } from "../database/query";
import { DatabaseService } from "../database/database.service";
import { initialRoles } from "./permissions";
import { hashPassword } from "./password";
import { UserDocument } from "./auth.service";

function parseId(id: string): Id {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      id,
    )
  )
    throw new BadRequestException("Invalid user ID");
  return uuid(id);
}

function toPublic(user: UserDocument) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    roleKeys: user.roleKeys,
    active: user.active,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

@Injectable()
export class UsersService {
  constructor(private readonly database: DatabaseService) {}

  private users() {
    return this.database.sql().table<UserDocument>("users");
  }

  private userRepository() {
    return this.users();
  }

  async list() {
    await this.database.ensureReady();
    return (await this.userRepository().find().toArray())
      .sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
      )
      .map(toPublic);
  }

  async create(
    email: string,
    password: string,
    roleKeys: string[],
    displayName?: string,
  ) {
    await this.database.ensureReady();
    this.validateRoles(roleKeys);
    const emailNormalized = email.trim().toLowerCase();
    const now = new Date();
    const user: UserDocument = {
      id: uuid(),
      email: emailNormalized,
      emailNormalized,
      displayName: displayName?.trim() || emailNormalized.split("@")[0],
      passwordHash: await hashPassword(password),
      roleKeys: [...new Set(roleKeys)],
      active: true,
      tokenVersion: 1,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.users().insertOne(user);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      )
        throw new ConflictException("Email is already in use");
      throw error;
    }
    return toPublic(user);
  }

  async update(
    id: string,
    changes: { active?: boolean; email?: string; displayName?: string },
  ) {
    await this.database.ensureReady();
    if (Object.values(changes).every((value) => value === undefined))
      throw new BadRequestException("No changes supplied");
    const recordId = parseId(id);
    const before = await this.users().findOne({ id: recordId });
    if (!before) throw new NotFoundException("User not found");
    const removingAdmin =
      changes.active === false &&
      before.active &&
      before.roleKeys.includes("SUPER_ADMIN");
    const fields: Partial<UserDocument> = { updatedAt: new Date() };
    if (changes.active !== undefined) fields.active = changes.active;
    if (changes.email !== undefined) {
      const normalized = changes.email.trim().toLowerCase();
      fields.email = normalized;
      fields.emailNormalized = normalized;
    }
    if (changes.displayName !== undefined)
      fields.displayName = changes.displayName.trim();
    let result: UserDocument | null;
    try {
      const mutation = (users: Table<UserDocument>, session?: SqlSession) =>
        users.findOneAndUpdate(
          { id: recordId },
          { $set: fields, $inc: { version: 1, tokenVersion: 1 } },
          { returnDocument: "after", session },
        );
      result = removingAdmin
        ? await this.withLastAdminGuard(recordId, mutation)
        : await mutation(this.users());
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      )
        throw new ConflictException("Email is already in use");
      throw error;
    }
    if (!result) throw new NotFoundException("User not found");
    return toPublic(result);
  }

  async assignRoles(id: string, roleKeys: string[]) {
    await this.database.ensureReady();
    this.validateRoles(roleKeys);
    const recordId = parseId(id);
    const before = await this.users().findOne({ id: recordId });
    if (!before) throw new NotFoundException("User not found");
    const removingAdmin =
      before.active &&
      before.roleKeys.includes("SUPER_ADMIN") &&
      !roleKeys.includes("SUPER_ADMIN");
    const mutation = (users: Table<UserDocument>, session?: SqlSession) =>
      users.findOneAndUpdate(
        { id: recordId },
        {
          $set: { roleKeys: [...new Set(roleKeys)], updatedAt: new Date() },
          $inc: { version: 1, tokenVersion: 1 },
        },
        { returnDocument: "after", session },
      );
    const result = removingAdmin
      ? await this.withLastAdminGuard(recordId, mutation)
      : await mutation(this.users());
    if (!result) throw new NotFoundException("User not found");
    return toPublic(result);
  }

  private validateRoles(roleKeys: string[]): void {
    if (
      roleKeys.length === 0 ||
      roleKeys.some((key) => !initialRoles.some((role) => role.key === key))
    ) {
      throw new BadRequestException("Invalid role assignment");
    }
  }

  private async withLastAdminGuard<T>(
    id: Id,
    mutation: (users: Table<UserDocument>, session: SqlSession) => Promise<T>,
  ): Promise<T> {
    return this.database.withTransaction(async (db, session) => {
      await db
        .table("auth_admin_guard")
        .updateOne(
          { id: "last-admin" as never },
          { $inc: { revision: 1 } },
          { session },
        );
      const users = db.table<UserDocument>("users");
      const current = await users.findOne({ id: id }, { session });
      if (!current) throw new NotFoundException("User not found");
      const count = await users.count(
        { active: true, roleKeys: "SUPER_ADMIN" },
        { session },
      );
      if (
        current.active &&
        current.roleKeys.includes("SUPER_ADMIN") &&
        count <= 1
      )
        throw new ConflictException("Last active administrator is required");
      return mutation(users, session);
    });
  }
}
