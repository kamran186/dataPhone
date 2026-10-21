import { randomUUID } from "node:crypto";
import {
  DatabaseError,
  type Pool,
  type PoolClient,
  type QueryResultRow,
} from "pg";
import { tableColumns } from "./tables";
export { DatabaseError };
export type Id = string;
// SQL rows without a domain record type are used only at repository boundaries.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
export type Filter<T = Row> = { [K in keyof T]?: unknown } & Record<
  string,
  unknown
>;
export type SqlSession = SqlDatabase;
export const uuidPattern =
  /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
export function uuid(value?: string): Id {
  if (value === undefined) return randomUUID();
  if (!uuidPattern.test(value)) throw new Error("Invalid UUID");
  return value.toLowerCase();
}
type Options = {
  session?: SqlSession;
  projection?: Record<string, number>;
  sort?: Record<string, number>;
  upsert?: boolean;
  returnDocument?: string;
  skipLocked?: boolean;
};
type Update = {
  $set?: object;
  $inc?: Record<string, number>;
  $unset?: object;
  $currentDate?: object;
  $setOnInsert?: object;
};
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

export class SqlDatabase {
  constructor(
    readonly executor: Pool | PoolClient,
    readonly transactional = false,
  ) {}
  async query<T extends QueryResultRow = Row>(
    sql: string,
    values: unknown[] = [],
  ) {
    return this.executor.query<T>(sql, values);
  }
  table<T extends object = Row>(name: string): Table<T> {
    if (!tableColumns[name]) throw new Error(`Unknown SQL table: ${name}`);
    return new Table<T>(this, name);
  }
}

export class Table<T extends object = Row> {
  private readonly fields: Record<string, string>;
  constructor(
    private readonly database: SqlDatabase,
    readonly name: string,
  ) {
    this.fields = tableColumns[name];
  }
  private db(options?: Options) {
    return options?.session ?? this.database;
  }
  private column(field: string): string {
    const [name, ...path] = field.split(".");
    if (!this.fields[name])
      throw new Error(`Unknown ${this.name} column: ${name}`);
    if (!path.length) return quote(name);
    if (
      this.fields[name] !== "jsonb" ||
      path.some((p) => !/^[A-Za-z0-9_]+$/.test(p))
    )
      throw new Error("Invalid JSON path");
    return `${quote(name)} #>> '{${path.join(",")}}'`;
  }
  private filter(filter: Filter<T>, values: unknown[]): string {
    const bind = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    return (
      Object.entries(filter)
        .map(([key, value]) => {
          if (key === "$or" || key === "$and") {
            const children = value as Filter<T>[];
            return children.length
              ? `(${children.map((f) => this.filter(f, values)).join(key === "$or" ? " OR " : " AND ")})`
              : key === "$or"
                ? "FALSE"
                : "TRUE";
          }
          const column = this.column(key);
          const array = this.fields[key]?.endsWith("[]");
          if (
            value &&
            typeof value === "object" &&
            !(value instanceof Date) &&
            !Buffer.isBuffer(value) &&
            !Array.isArray(value)
          ) {
            const operators = value as Record<string, unknown>;
            return Object.entries(operators)
              .filter(([op]) => op !== "$options")
              .map(([op, arg]) => {
                if (op === "$exists")
                  return `${column} IS ${arg ? "NOT " : ""}NULL`;
                if (op === "$in" || op === "$nin") {
                  const items = arg as unknown[];
                  if (array && items.length)
                    return `${op === "$nin" ? "NOT " : ""}(${column} && ${bind(items)}::${this.fields[key]})`;
                  if (!items.length) return op === "$in" ? "FALSE" : "TRUE";
                  return `${column} ${op === "$nin" ? "NOT " : ""}IN (${items.map(bind).join(",")})`;
                }
                if (op === "$regex")
                  return `${column} ${operators.$options === "i" ? "~*" : "~"} ${bind(arg)}`;
                const sign: Record<string, string> = {
                  $eq: "=",
                  $ne: "<>",
                  $lt: "<",
                  $lte: "<=",
                  $gt: ">",
                  $gte: ">=",
                };
                if (!sign[op]) throw new Error(`Unsupported SQL filter: ${op}`);
                if (arg === null || arg === undefined)
                  return `${column} IS ${op === "$ne" ? "NOT " : ""}NULL`;
                return op === "$ne"
                  ? `(${column} <> ${bind(arg)} OR ${column} IS NULL)`
                  : `${column} ${sign[op]} ${bind(arg)}`;
              })
              .join(" AND ");
          }
          if (value === null || value === undefined) return `${column} IS NULL`;
          return array && !Array.isArray(value)
            ? `${bind(value)} = ANY(${column})`
            : `${column} = ${bind(value)}`;
        })
        .join(" AND ") || "TRUE"
    );
  }
  private decode(row: Row): T {
    return Object.fromEntries(
      Object.entries(row)
        .filter(
          ([key, value]) =>
            value !== null || key === "previous" || key === "next",
        )
        .map(([key, value]) => [
          key,
          this.fields[key] === "bigint" && value !== null
            ? Number(value)
            : value,
        ]),
    ) as T;
  }
  private order(sort: Record<string, number> = {}) {
    return Object.entries(sort)
      .map(([key, dir]) => `${this.column(key)} ${dir === -1 ? "DESC" : "ASC"}`)
      .join(",");
  }
  find(filter: Filter<T> = {}, options: Options = {}) {
    return new Selection(this, filter, options);
  }
  async select(
    filter: Filter<T>,
    options: Options,
    limit?: number,
    offset = 0,
  ): Promise<T[]> {
    const values: unknown[] = [];
    const where = this.filter(filter, values);
    const order = this.order(options.sort);
    const projection =
      options.projection && Object.values(options.projection).some(Boolean)
        ? [
            ...new Set([
              "id",
              ...Object.entries(options.projection)
                .filter(([, v]) => v)
                .map(([k]) => k),
            ]),
          ]
            .map((f) => this.column(f))
            .join(",")
        : "*";
    const result = await this.db(options).query(
      `SELECT ${projection} FROM ${quote(this.name)} WHERE ${where}${order ? ` ORDER BY ${order}` : ""}${limit !== undefined ? ` LIMIT ${Math.max(0, Math.floor(limit))}` : ""} OFFSET ${Math.max(0, Math.floor(offset))}`,
      values,
    );
    return result.rows.map((row) => this.decode(row));
  }
  async findOne(
    filter: Filter<T> = {},
    options: Options = {},
  ): Promise<T | null> {
    return (await this.select(filter, options, 1))[0] ?? null;
  }
  async count(filter: Filter<T> = {}, options: Options = {}): Promise<number> {
    const values: unknown[] = [];
    const result = await this.db(options).query(
      `SELECT count(*)::int AS count FROM ${quote(this.name)} WHERE ${this.filter(filter, values)}`,
      values,
    );
    return result.rows[0].count;
  }
  async insertOne(record: object, options: Options = {}) {
    const values: unknown[] = [];
    const item = {
      id: this.fields.id === "uuid" ? uuid() : undefined,
      ...record,
    } as Row;
    const entries = Object.entries(item).filter(
      ([, value]) => value !== undefined,
    );
    const params = entries.map(([key, value]) => {
      this.column(key);
      values.push(this.fields[key] === "jsonb" ? JSON.stringify(value) : value);
      return `$${values.length}`;
    });
    const result = await this.db(options).query(
      `INSERT INTO ${quote(this.name)} (${entries.map(([key]) => quote(key)).join(",")}) VALUES (${params.join(",")}) RETURNING id`,
      values,
    );
    return { insertedId: result.rows[0].id as Id };
  }
  async insertMany(records: object[], options: Options = {}) {
    const insertedIds: Id[] = [];
    for (const record of records)
      insertedIds.push((await this.insertOne(record, options)).insertedId);
    return { insertedIds, insertedCount: insertedIds.length };
  }
  private async update(
    filter: Filter<T>,
    update: Update,
    options: Options,
    many: boolean,
  ): Promise<T[]> {
    const values: unknown[] = [];
    const assignments: string[] = [];
    const bind = (field: string, value: unknown) => {
      values.push(
        this.fields[field] === "jsonb" && value !== undefined
          ? JSON.stringify(value)
          : (value ?? null),
      );
      return `$${values.length}`;
    };
    for (const [field, value] of Object.entries(update.$set ?? {}))
      assignments.push(`${this.column(field)} = ${bind(field, value)}`);
    for (const [field, value] of Object.entries(update.$inc ?? {}))
      assignments.push(
        `${this.column(field)} = COALESCE(${this.column(field)},0) + ${bind(field, value)}`,
      );
    for (const field of Object.keys(update.$unset ?? {}))
      assignments.push(`${this.column(field)} = NULL`);
    for (const field of Object.keys(update.$currentDate ?? {}))
      assignments.push(`${this.column(field)} = now()`);
    const where = this.filter(filter, values);
    const order = this.order(options.sort);
    const db = this.db(options);
    const target = `SELECT id FROM ${quote(this.name)} WHERE ${where}${order ? ` ORDER BY ${order}` : ""}${many ? "" : " LIMIT 1"} FOR UPDATE${options.skipLocked ? " SKIP LOCKED" : ""}`;
    if (!assignments.length) assignments.push("id = id");
    const result = await db.query(
      `WITH target AS (${target}) UPDATE ${quote(this.name)} SET ${assignments.join(",")} WHERE id IN (SELECT id FROM target) RETURNING *`,
      values,
    );
    if (!result.rows.length && options.upsert) {
      const equality = Object.fromEntries(
        Object.entries(filter).filter(
          ([key, value]) =>
            !key.startsWith("$") &&
            (typeof value !== "object" ||
              value instanceof Date ||
              value === null),
        ),
      );
      const record: Row = {
        ...equality,
        ...update.$setOnInsert,
        ...update.$set,
      };
      for (const [key, value] of Object.entries(update.$inc ?? {}))
        record[key] = (record[key] ?? 0) + value;
      const entries = Object.entries({
        id: this.fields.id === "uuid" ? uuid() : undefined,
        ...record,
      }).filter(([, v]) => v !== undefined);
      const insertValues = entries.map(([key, value]) =>
        this.fields[key] === "jsonb" ? JSON.stringify(value) : value,
      );
      entries.forEach(([key]) => this.column(key));
      const inserted = await db.query(
        `INSERT INTO ${quote(this.name)} (${entries.map(([key]) => quote(key)).join(",")}) VALUES (${entries.map((_, i) => `$${i + 1}`).join(",")}) ON CONFLICT DO NOTHING RETURNING *`,
        insertValues,
      );
      if (inserted.rows.length)
        return inserted.rows.map((row) => this.decode(row));
      return this.update(filter, update, { ...options, upsert: false }, many);
    }
    return result.rows.map((row) => this.decode(row));
  }
  async findOneAndUpdate(
    filter: Filter<T>,
    update: Update,
    options: Options = {},
  ): Promise<T | null> {
    return (await this.update(filter, update, options, false))[0] ?? null;
  }
  async updateOne(filter: Filter<T>, update: Update, options: Options = {}) {
    const rows = await this.update(filter, update, options, false);
    return { matchedCount: rows.length, modifiedCount: rows.length };
  }
  async updateMany(filter: Filter<T>, update: Update, options: Options = {}) {
    const rows = await this.update(filter, update, options, true);
    return { matchedCount: rows.length, modifiedCount: rows.length };
  }
  async replaceOne(filter: Filter<T>, record: T, options: Options = {}) {
    return this.updateOne(filter, { $set: record }, options);
  }
  async deleteMany(filter: Filter<T> = {}, options: Options = {}) {
    const values: unknown[] = [];
    const where = this.filter(filter, values);
    const result = await this.db(options).query(
      `DELETE FROM ${quote(this.name)} WHERE ${where}`,
      values,
    );
    return { deletedCount: result.rowCount ?? 0 };
  }
  async deleteOne(filter: Filter<T>, options: Options = {}) {
    const values: unknown[] = [];
    const where = this.filter(filter, values);
    const result = await this.db(options).query(
      `DELETE FROM ${quote(this.name)} WHERE id IN (SELECT id FROM ${quote(this.name)} WHERE ${where} LIMIT 1)`,
      values,
    );
    return { deletedCount: result.rowCount ?? 0 };
  }
}
class Selection<T extends object> implements AsyncIterable<T> {
  private limitValue?: number;
  private offset = 0;
  constructor(
    private readonly table: Table<T>,
    private readonly filter: Filter<T>,
    private options: Options,
  ) {}
  sort(value: Record<string, number>) {
    this.options = { ...this.options, sort: value };
    return this;
  }
  limit(value: number) {
    this.limitValue = value;
    return this;
  }
  skip(value: number) {
    this.offset = value;
    return this;
  }
  toArray() {
    return this.table.select(
      this.filter,
      this.options,
      this.limitValue,
      this.offset,
    );
  }
  async *[Symbol.asyncIterator]() {
    for (const row of await this.toArray()) yield row;
  }
}
