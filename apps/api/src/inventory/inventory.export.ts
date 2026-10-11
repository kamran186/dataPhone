import ExcelJS from "exceljs";

export interface ExportRow {
  e164: string;
  status: string;
  carrier?: string;
  carrierAccount?: string;
  customerName?: string;
  updatedAt: Date;
}

const headers = [
  "Number",
  "Status",
  "Carrier",
  "Carrier account",
  "Customer",
  "Updated at",
];

function safeCell(value: unknown): string {
  const text = value === undefined || value === null ? "" : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function toCsv(rows: ExportRow[]): string {
  const lines = [
    headers,
    ...rows.map((row) => [
      row.e164,
      row.status,
      row.carrier,
      row.carrierAccount,
      row.customerName,
      row.updatedAt.toISOString(),
    ]),
  ];
  return (
    "\uFEFF" +
    lines
      .map((fields) =>
        fields
          .map((field) => `"${safeCell(field).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\r\n") +
    "\r\n"
  );
}

export async function toXlsx(rows: ExportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Inventory");
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  sheet.columns = [18, 14, 16, 24, 28, 26].map((width) => ({ width }));
  for (const row of rows) {
    sheet.addRow([
      row.e164,
      row.status,
      row.carrier ?? "",
      row.carrierAccount ?? "",
      row.customerName ?? "",
      row.updatedAt.toISOString(),
    ]);
  }
  sheet.autoFilter = { from: "A1", to: `F${rows.length + 1}` };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
