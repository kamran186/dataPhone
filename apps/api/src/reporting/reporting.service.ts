import { BadRequestException, Injectable } from "@nestjs/common";
import type { Document } from "mongodb";
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
const definitions: Record<
  ReportType,
  {
    collection: string;
    columns: string[];
    pipeline: Document[];
    searchFields: string[];
  }
> = {
  "all-dids": {
    collection: "phone_numbers",
    columns: [
      "Number",
      "Status",
      "Carrier",
      "Carrier account",
      "Customer",
      "Updated at",
    ],
    pipeline: numberPipeline(),
    searchFields: ["Number", "Carrier", "Customer"],
  },
  "by-carrier": {
    collection: "phone_numbers",
    columns: [
      "Number",
      "Status",
      "Carrier",
      "Carrier account",
      "Customer",
      "Updated at",
    ],
    pipeline: numberPipeline(),
    searchFields: ["Number", "Carrier", "Customer"],
  },
  "by-customer": {
    collection: "phone_numbers",
    columns: [
      "Number",
      "Status",
      "Carrier",
      "Carrier account",
      "Customer",
      "Updated at",
    ],
    pipeline: [...numberPipeline(), { $match: { Customer: { $ne: "" } } }],
    searchFields: ["Number", "Carrier", "Customer"],
  },
  unassigned: {
    collection: "phone_numbers",
    columns: [
      "Number",
      "Status",
      "Carrier",
      "Carrier account",
      "Customer",
      "Updated at",
    ],
    pipeline: [
      ...numberPipeline(),
      { $match: { Status: "active", Customer: "" } },
    ],
    searchFields: ["Number", "Carrier"],
  },
  "assignment-history": {
    collection: "number_assignments",
    columns: ["Number", "Customer", "Started at", "Ended at", "Active"],
    pipeline: [
      {
        $lookup: {
          from: "phone_numbers",
          localField: "phoneNumberId",
          foreignField: "_id",
          as: "number",
        },
      },
      {
        $lookup: {
          from: "customers",
          localField: "customerId",
          foreignField: "_id",
          as: "customer",
        },
      },
      {
        $project: {
          Number: { $ifNull: [{ $first: "$number.e164" }, ""] },
          Customer: { $ifNull: [{ $first: "$customer.name" }, ""] },
          "Started at": { $dateToString: { date: "$startedAt", onNull: "" } },
          "Ended at": { $dateToString: { date: "$endedAt", onNull: "" } },
          Active: { $cond: ["$active", "Yes", "No"] },
        },
      },
    ],
    searchFields: ["Number", "Customer"],
  },
  "purchase-history": {
    collection: "purchase_orders",
    columns: ["Order ID", "Status", "Customer", "Numbers", "Created at"],
    pipeline: [
      {
        $lookup: {
          from: "customers",
          localField: "customerId",
          foreignField: "_id",
          as: "customer",
        },
      },
      {
        $project: {
          "Order ID": { $toString: "$_id" },
          Status: "$status",
          Customer: { $ifNull: [{ $first: "$customer.name" }, ""] },
          Numbers: { $toString: { $size: { $ifNull: ["$nativeIds", []] } } },
          "Created at": { $dateToString: { date: "$createdAt", onNull: "" } },
        },
      },
    ],
    searchFields: ["Order ID", "Customer", "Status"],
  },
  "open-ports": {
    collection: "port_requests",
    columns: [
      "Port ID",
      "Status",
      "Numbers",
      "Customer",
      "Current provider",
      "Updated at",
    ],
    pipeline: [
      {
        $match: {
          status: { $in: ["DRAFT", "SUBMITTED", "DATE_CONFIRMED", "REJECTED"] },
        },
      },
      {
        $lookup: {
          from: "customers",
          localField: "customerId",
          foreignField: "_id",
          as: "customer",
        },
      },
      {
        $project: {
          "Port ID": { $toString: "$_id" },
          Status: "$status",
          Numbers: {
            $reduce: {
              input: "$numbers",
              initialValue: "",
              in: {
                $concat: [
                  "$$value",
                  { $cond: [{ $eq: ["$$value", ""] }, "", ", "] },
                  "$$this",
                ],
              },
            },
          },
          Customer: { $ifNull: [{ $first: "$customer.name" }, ""] },
          "Current provider": "$currentProvider",
          "Updated at": { $dateToString: { date: "$updatedAt", onNull: "" } },
        },
      },
    ],
    searchFields: ["Port ID", "Numbers", "Customer", "Status"],
  },
  "sync-failures": {
    collection: "carrier_sync_runs",
    columns: ["Carrier account", "Error code", "Started at", "Finished at"],
    pipeline: [
      { $match: { status: "failed" } },
      {
        $lookup: {
          from: "carrier_accounts",
          localField: "carrierAccountId",
          foreignField: "_id",
          as: "account",
        },
      },
      {
        $project: {
          "Carrier account": {
            $ifNull: [{ $first: "$account.externalAccountId" }, ""],
          },
          "Error code": { $ifNull: ["$errorCode", ""] },
          "Started at": { $dateToString: { date: "$startedAt", onNull: "" } },
          "Finished at": { $dateToString: { date: "$finishedAt", onNull: "" } },
        },
      },
    ],
    searchFields: ["Carrier account", "Error code"],
  },
};

function numberPipeline(): Document[] {
  return [
    {
      $lookup: {
        from: "carriers",
        localField: "carrierId",
        foreignField: "_id",
        as: "carrier",
      },
    },
    {
      $lookup: {
        from: "carrier_accounts",
        localField: "carrierAccountId",
        foreignField: "_id",
        as: "account",
      },
    },
    {
      $lookup: {
        from: "number_assignments",
        let: { numberId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$phoneNumberId", "$$numberId"] },
                  { $eq: ["$active", true] },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: "assignment",
      },
    },
    {
      $lookup: {
        from: "customers",
        localField: "assignment.customerId",
        foreignField: "_id",
        as: "customer",
      },
    },
    {
      $project: {
        Number: "$e164",
        Status: "$status",
        Carrier: { $ifNull: [{ $first: "$carrier.code" }, ""] },
        "Carrier account": {
          $ifNull: [{ $first: "$account.externalAccountId" }, ""],
        },
        Customer: { $ifNull: [{ $first: "$customer.name" }, ""] },
        "Updated at": { $dateToString: { date: "$updatedAt", onNull: "" } },
      },
    },
  ];
}

function validType(raw: string): ReportType {
  if (!reportTypes.includes(raw as ReportType))
    throw new BadRequestException("Invalid report type");
  return raw as ReportType;
}
@Injectable()
export class ReportingService {
  constructor(private readonly database: DatabaseService) {}
  async dashboard() {
    await this.database.ensureReady();
    const db = this.database.nativeDb();
    const [
      totalDids,
      activeDids,
      assigned,
      openPorts,
      pendingPurchases,
      failedJobs,
      byCarrier,
      accounts,
    ] = await Promise.all([
      db.collection("phone_numbers").countDocuments(),
      db.collection("phone_numbers").countDocuments({ status: "active" }),
      db
        .collection("number_assignments")
        .aggregate([
          { $match: { active: true } },
          {
            $lookup: {
              from: "phone_numbers",
              localField: "phoneNumberId",
              foreignField: "_id",
              as: "number",
            },
          },
          { $match: { "number.status": "active" } },
          { $count: "value" },
        ])
        .next()
        .then((result) => (result?.value as number) ?? 0),
      db.collection("port_requests").countDocuments({
        status: { $in: ["DRAFT", "SUBMITTED", "DATE_CONFIRMED", "REJECTED"] },
      }),
      db.collection("purchase_orders").countDocuments({
        status: {
          $in: ["queued", "running", "retrying", "pending", "partial"],
        },
      }),
      db.collection("background_jobs").countDocuments({ status: "failed" }),
      db
        .collection("phone_numbers")
        .aggregate([
          { $group: { _id: "$carrierId", count: { $sum: 1 } } },
          {
            $lookup: {
              from: "carriers",
              localField: "_id",
              foreignField: "_id",
              as: "carrier",
            },
          },
          {
            $project: {
              _id: 0,
              carrier: { $ifNull: [{ $first: "$carrier.code" }, "unknown"] },
              count: 1,
            },
          },
          { $sort: { carrier: 1 } },
        ])
        .toArray(),
      db
        .collection("carrier_accounts")
        .aggregate([
          {
            $lookup: {
              from: "carrier_sync_runs",
              let: { accountId: "$_id" },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ["$carrierAccountId", "$$accountId"] },
                  },
                },
                { $sort: { startedAt: -1 } },
                { $limit: 1 },
              ],
              as: "latest",
            },
          },
          {
            $lookup: {
              from: "carriers",
              localField: "carrierId",
              foreignField: "_id",
              as: "carrier",
            },
          },
          {
            $project: {
              _id: 0,
              account: "$externalAccountId",
              carrier: { $first: "$carrier.code" },
              status: {
                $ifNull: [{ $first: "$latest.status" }, "never_synced"],
              },
              lastSyncedAt: 1,
            },
          },
          { $sort: { carrier: 1, account: 1 } },
        ])
        .toArray(),
    ]);
    return {
      totalDids,
      activeDids,
      assigned,
      potentiallyUnused: Math.max(0, activeDids - assigned),
      openPorts,
      pendingPurchases,
      failedJobs,
      byCarrier,
      carrierSync: accounts,
    };
  }
  async report(
    rawType: string,
    raw: Record<string, string | undefined>,
    exporting = false,
  ) {
    const type = validType(rawType);
    const page = Number(raw.page ?? 1),
      pageSize = exporting ? 10_000 : Number(raw.pageSize ?? 50);
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 10_000 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > (exporting ? 10_000 : 100)
    )
      throw new BadRequestException("Invalid report page");
    const search = raw.search?.trim() ?? "";
    if (search.length > 100)
      throw new BadRequestException("Invalid report search");
    const definition = definitions[type];
    const pipeline = [...definition.pipeline];
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      pipeline.push({
        $match: {
          $or: definition.searchFields.map((field) => ({
            [field]: { $regex: escaped, $options: "i" },
          })),
        },
      });
    }
    pipeline.push({
      $facet: {
        rows: [
          {
            $sort: {
              [type === "by-carrier"
                ? "Carrier"
                : type === "by-customer"
                  ? "Customer"
                  : definition.columns[0]]: 1,
              [definition.columns[0]]: 1,
            },
          },
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
        ],
        count: [{ $count: "value" }],
      },
    });
    await this.database.ensureReady();
    const result = await this.database
      .nativeDb()
      .collection(definition.collection)
      .aggregate<{ rows: ReportRow[]; count: Array<{ value: number }> }>(
        pipeline,
        { allowDiskUse: true },
      )
      .next();
    const total = result?.count[0]?.value ?? 0;
    if (exporting && total > 10_000)
      throw new BadRequestException(
        "Report exceeds 10,000 row export limit; narrow the search",
      );
    return {
      type,
      columns: definition.columns,
      rows: result?.rows ?? [],
      total,
      page,
      pageSize,
    };
  }
}
