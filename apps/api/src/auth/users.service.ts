import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ClientSession, Collection, ObjectId } from "mongodb";
import { DatabaseService } from "../database/database.service";
import { initialRoles } from "./permissions";
import { hashPassword } from "./password";
import { UserDocument } from "./auth.service";

function parseId(id: string): ObjectId {
  if (!/^[a-f0-9]{24}$/.test(id))
    throw new BadRequestException("Invalid user ID");
  return new ObjectId(id);
}

function toPublic(user: UserDocument) {
  return {
    id: user._id.toHexString(),
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
    return this.database.nativeDb().collection<UserDocument>("users");
  }

  private userRepository() {
    return this.database.repository<UserDocument>("User");
  }

  async list() {
    await this.database.ensureReady();
    return (await this.userRepository().find())
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
      _id: new ObjectId(),
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
      await this.userRepository().save(user);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === 11000
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
    const objectId = parseId(id);
    const before = await this.users().findOne({ _id: objectId });
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
      const mutation = (
        users: Collection<UserDocument>,
        session?: ClientSession,
      ) =>
        users.findOneAndUpdate(
          { _id: objectId },
          { $set: fields, $inc: { version: 1, tokenVersion: 1 } },
          { returnDocument: "after", session },
        );
      result = removingAdmin
        ? await this.withLastAdminGuard(objectId, mutation)
        : await mutation(this.users());
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === 11000
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
    const objectId = parseId(id);
    const before = await this.users().findOne({ _id: objectId });
    if (!before) throw new NotFoundException("User not found");
    const removingAdmin =
      before.active &&
      before.roleKeys.includes("SUPER_ADMIN") &&
      !roleKeys.includes("SUPER_ADMIN");
    const mutation = (
      users: Collection<UserDocument>,
      session?: ClientSession,
    ) =>
      users.findOneAndUpdate(
        { _id: objectId },
        {
          $set: { roleKeys: [...new Set(roleKeys)], updatedAt: new Date() },
          $inc: { version: 1, tokenVersion: 1 },
        },
        { returnDocument: "after", session },
      );
    const result = removingAdmin
      ? await this.withLastAdminGuard(objectId, mutation)
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
    id: ObjectId,
    mutation: (
      users: Collection<UserDocument>,
      session: ClientSession,
    ) => Promise<T>,
  ): Promise<T> {
    return this.database.withTransaction(async (db, session) => {
      await db
        .collection("auth_admin_guard")
        .updateOne(
          { _id: "last-admin" as never },
          { $inc: { revision: 1 } },
          { session },
        );
      const users = db.collection<UserDocument>("users");
      const current = await users.findOne({ _id: id }, { session });
      if (!current) throw new NotFoundException("User not found");
      const count = await users.countDocuments(
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
