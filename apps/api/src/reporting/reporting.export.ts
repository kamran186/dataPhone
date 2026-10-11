import ExcelJS from "exceljs";
import type { ReportRow } from "./reporting.service";

function safe(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
export function reportCsv(columns: string[], rows: ReportRow[]): string {
  return (
    "\uFEFF" +
    [columns, ...rows.map((row) => columns.map((column) => row[column] ?? ""))]
      .map((values) =>
        values
          .map((value) => `"${safe(String(value)).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\r\n") +
    "\r\n"
  );
}
export async function reportXlsx(
  columns: string[],
  rows: ReportRow[],
): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Report");
  sheet.addRow(columns);
  sheet.getRow(1).font = { bold: true };
  sheet.columns = columns.map(() => ({ width: 25 }));
  for (const row of rows)
    sheet.addRow(columns.map((column) => safe(String(row[column] ?? ""))));
  sheet.autoFilter = {
    from: "A1",
    to: { row: rows.length + 1, column: columns.length },
  };
  return Buffer.from(await book.xlsx.writeBuffer());
}
