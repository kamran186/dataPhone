import { BadRequestException, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
export const reportTypes = [
  "all-dids",
  "by-carrier",
  "by-customer",
  "unassigned",
  "assignment-history",
  "purchase-history",
  "open-ports",
  "sync-failures",
] as const;
export type ReportType = (typeof reportTypes)[number];
export interface ReportRow {
  [key: string]: string;
}
const date = (field: string) =>
  `COALESCE(to_char(${field} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'')`;
const numbers = `SELECT n.e164 AS "Number", n.status AS "Status", COALESCE(c.code,'') AS "Carrier", COALESCE(a."externalAccountId",'') AS "Carrier account", COALESCE(u.name,'') AS "Customer", ${date('n."updatedAt"')} AS "Updated at" FROM phone_numbers n LEFT JOIN carriers c ON c.id=n."carrierId" LEFT JOIN carrier_accounts a ON a.id=n."carrierAccountId" LEFT JOIN number_assignments s ON s."phoneNumberId"=n.id AND s.active LEFT JOIN customers u ON u.id=s."customerId"`;
const definitions: Record<
  ReportType,
  { sql: string; columns: string[]; search: string[] }
> = {
  "all-dids": {
    sql: numbers,
    columns: [
      "Number",
      "Status",
      "Carrier",
      "Carrier account",
      "Customer",
      "Updated at",
    ],
    search: ["Number", "Carrier", "Customer"],
  },
  "by-carrier": {
    sql: numbers,
    columns: [
      "Number",
      "Status",
      "Carrier",
      "Carrier account",
      "Customer",
      "Updated at",
    ],
    search: ["Number", "Carrier", "Customer"],
  },
  "by-customer": {
    sql: numbers + " WHERE u.id IS NOT NULL",
    columns: [
      "Number",
      "Status",
      "Carrier",
      "Carrier account",
      "Customer",
      "Updated at",
    ],
    search: ["Number", "Carrier", "Customer"],
  },
  unassigned: {
    sql: numbers + " WHERE n.status='active' AND s.id IS NULL",
    columns: [
      "Number",
      "Status",
      "Carrier",
      "Carrier account",
      "Customer",
      "Updated at",
    ],
    search: ["Number", "Carrier"],
  },
  "assignment-history": {
    sql: `SELECT COALESCE(n.e164,'') AS "Number", COALESCE(c.name,'') AS "Customer", ${date('a."startedAt"')} AS "Started at", ${date('a."endedAt"')} AS "Ended at", CASE WHEN a.active THEN 'Yes' ELSE 'No' END AS "Active" FROM number_assignments a LEFT JOIN phone_numbers n ON n.id=a."phoneNumberId" LEFT JOIN customers c ON c.id=a."customerId"`,
    columns: ["Number", "Customer", "Started at", "Ended at", "Active"],
    search: ["Number", "Customer"],
  },
  "purchase-history": {
    sql: `SELECT p.id::text AS "Order ID", p.status AS "Status", COALESCE(c.name,'') AS "Customer", COALESCE(cardinality(p."nativeIds"),0)::text AS "Numbers", ${date('p."createdAt"')} AS "Created at" FROM purchase_orders p LEFT JOIN customers c ON c.id=p."customerId"`,
    columns: ["Order ID", "Status", "Customer", "Numbers", "Created at"],
    search: ["Order ID", "Customer", "Status"],
  },
  "open-ports": {
    sql: `SELECT p.id::text AS "Port ID", p.status AS "Status", COALESCE(array_to_string(p.numbers,', '),'') AS "Numbers", COALESCE(c.name,'') AS "Customer", p."currentProvider" AS "Current provider", ${date('p."updatedAt"')} AS "Updated at" FROM port_requests p LEFT JOIN customers c ON c.id=p."customerId" WHERE p.status IN ('DRAFT','SUBMITTED','DATE_CONFIRMED','REJECTED')`,
    columns: [
      "Port ID",
      "Status",
      "Numbers",
      "Customer",
      "Current provider",
      "Updated at",
    ],
    search: ["Port ID", "Numbers", "Customer", "Status"],
  },
  "sync-failures": {
    sql: `SELECT COALESCE(a."externalAccountId",'') AS "Carrier account", COALESCE(s."errorCode",'') AS "Error code", ${date('s."startedAt"')} AS "Started at", ${date('s."finishedAt"')} AS "Finished at" FROM carrier_sync_runs s LEFT JOIN carrier_accounts a ON a.id=s."carrierAccountId" WHERE s.status='failed'`,
    columns: ["Carrier account", "Error code", "Started at", "Finished at"],
    search: ["Carrier account", "Error code"],
  },
};
@Injectable()
export class ReportingService {
  constructor(private readonly database: DatabaseService) {}
  async dashboard() {
    await this.database.ensureReady();
    const db = this.database.sql();
    const [counts, byCarrier, accounts] = await Promise.all([
      db.query(
        `SELECT (SELECT count(*)::int FROM phone_numbers) AS "totalDids", (SELECT count(*)::int FROM phone_numbers WHERE status='active') AS "activeDids", (SELECT count(*)::int FROM number_assignments a JOIN phone_numbers n ON n.id=a."phoneNumberId" WHERE a.active AND n.status='active') AS assigned, (SELECT count(*)::int FROM port_requests WHERE status IN ('DRAFT','SUBMITTED','DATE_CONFIRMED','REJECTED')) AS "openPorts", (SELECT count(*)::int FROM purchase_orders WHERE status IN ('queued','running','retrying','pending','partial')) AS "pendingPurchases", (SELECT count(*)::int FROM background_jobs WHERE status='failed') AS "failedJobs"`,
      ),
      db.query(
        `SELECT COALESCE(c.code,'unknown') AS carrier,count(*)::int AS count FROM phone_numbers n LEFT JOIN carriers c ON c.id=n."carrierId" GROUP BY c.code ORDER BY carrier`,
      ),
      db.query(
        `SELECT a."externalAccountId" AS account,c.code AS carrier,COALESCE(s.status,'never_synced') AS status,a."lastSyncedAt" FROM carrier_accounts a LEFT JOIN carriers c ON c.id=a."carrierId" LEFT JOIN LATERAL (SELECT status FROM carrier_sync_runs WHERE "carrierAccountId"=a.id ORDER BY "startedAt" DESC LIMIT 1) s ON true ORDER BY c.code,a."externalAccountId"`,
      ),
    ]);
    const values = counts.rows[0];
    return {
      ...values,
      potentiallyUnused: Math.max(0, values.activeDids - values.assigned),
      byCarrier: byCarrier.rows,
      carrierSync: accounts.rows,
    };
  }
  async report(
    rawType: string,
    raw: Record<string, string | undefined>,
    exporting = false,
  ) {
    if (!reportTypes.includes(rawType as ReportType))
      throw new BadRequestException("Invalid report type");
    const type = rawType as ReportType;
    const page = Number(raw.page ?? 1),
      pageSize = exporting ? 10000 : Number(raw.pageSize ?? 50);
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 10000 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > (exporting ? 10000 : 100)
    )
      throw new BadRequestException("Invalid report page");
    const search = raw.search?.trim() ?? "";
    if (search.length > 100)
      throw new BadRequestException("Invalid report search");
    const definition = definitions[type];
    // Definitions supply identifiers; search values are always bound parameters.
    const where = search
      ? ` WHERE ${definition.search.map((column) => `position(lower($1) in lower(COALESCE("${column}",''))) > 0`).join(" OR ")}`
      : "";
    const params = search ? [search] : [];
    const order =
      type === "by-carrier"
        ? "Carrier"
        : type === "by-customer"
          ? "Customer"
          : definition.columns[0];
    await this.database.ensureReady();
    const db = this.database.sql();
    const source = `(${definition.sql}) report`;
    const total = (
      await db.query(
        `SELECT count(*)::int AS total FROM ${source}${where}`,
        params,
      )
    ).rows[0].total as number;
    if (exporting && total > 10000)
      throw new BadRequestException(
        "Report exceeds 10,000 row export limit; narrow the search",
      );
    const result = await db.query<ReportRow>(
      `SELECT * FROM ${source}${where} ORDER BY "${order}", "${definition.columns[0]}" LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params,
    );
    return {
      type,
      columns: definition.columns,
      rows: result.rows,
      total,
      page,
      pageSize,
    };
  }
}
