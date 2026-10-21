# Browser acceptance — October 21, 2026

Tested the packaged application at `http://localhost:8080` through the visible browser, backed by PostgreSQL 17 and the application worker. All carrier write actions used the explicit development mock carrier. The test records remain available for inspection.

## Workflows verified

| Area | Browser result |
| --- | --- |
| Authentication | Administrator and viewer sign-in, rejected invalid credentials, sign-out, and session restoration after reload passed. |
| Overview and users | Operational counts and report links loaded; the administrator saw all four seeded staff roles. |
| Customers | Created `BROWSER-E2E-20261021`, changed its name to `Browser E2E Verified`, and verified creation/update history. |
| Inventory | List, number detail, customer/number/status filters, empty results, holding history, and customer assignment history passed. |
| Ownership | Bulk-assigned two numbers, transferred one to Acme Services, then unassigned it. Closed assignments and audit history were retained. |
| Available numbers | Administrator and viewer searches returned available mock offers; purchased numbers were excluded from later searches. Viewer results had no purchase controls. |
| Mock purchase | Order `e2940dbc-4a6d-4f22-876d-c0e7220e353b` completed with two confirmed numbers, both assigned to the test customer. |
| Mock disconnect | Disconnected `+12025550109` using exact-number confirmation; its holding closed and the job succeeded. |
| Ports | Created/submitted two drafts (`+12125550921`, `+12125550922`), observed confirmed dates, and verified completion plus inventory/customer assignment. Corrected and resubmitted a seeded rejection; cancelled an unsubmitted draft and retained its history. |
| Port documents | Uploaded a synthetic PNG and downloaded it through the UI. Downloaded bytes matched the source SHA-256. |
| Jobs | Inspected purchase, disconnect, and port job status plus queued/started/progress/succeeded events. Failure details remained generic. |
| Synchronization | Final mock reconciliation succeeded: 19 numbers seen, zero issues in that run. |
| Reports | All DIDs, by carrier, by customer, unassigned, assignment history, purchase history, open ports, and synchronization failures loaded. Customer-filtered CSV and Excel exports downloaded successfully. |
| Inventory exports | Viewer downloaded CSV and Excel for the five test-customer numbers. Combined number/customer/status filters returned the expected match or empty state. |
| Permissions | Viewer navigation omitted purchases, ports, jobs, and users; direct access to those routes was denied. Viewer number detail showed the customer name without assignment/disconnect controls. |

## Fixes found during acceptance

- Preserved stored mock carrier number IDs during inventory reconciliation, removing false duplicate-carrier warnings.
- Removed the invalid synthetic carrier order ID from new sample pending purchases. The existing disposable sample row was repaired separately; seed commands still preserve existing records.
- Added port field names and autofill hints; the browser no longer filled port account fields with sign-in credentials. Sensitive fields remain masked.
- Displayed the carrier's confirmed calendar date using UTC so local time zones cannot move it to the previous day.
- Refreshed submitted/confirmed port details periodically, stopping when the request leaves those states. Completed ports retain the confirmed date without claiming they are still in progress.
- Looked up the active customer directly for authorized viewers, independent of assignment permissions and the first customer-list page.

## Final verification

- API: 17 suites / 95 tests passed against isolated PostgreSQL schemas.
- Web: 5 files / 21 tests passed. New regressions were observed failing before the viewer-name and completed-port fixes.
- Typecheck, lint, formatting, and whitespace checks passed.
- Final API/web Compose images built and started successfully. Existing frontend bundle-size warning remains.
- Running audit chain verified after browser mutations: valid, 38 events.
- Final browser console error check returned no errors.
- Independent review of the acceptance fixes found no critical, important, or minor issues.
- Screenshot: `test-results/browser-acceptance/customer-verification.png` (local test artifact).

The final inventory held 22 numbers. The test customer held five: one bulk assignment, two mock purchases, and two mock ports. Earlier failed sample jobs and the deliberately seeded reconciliation issue remain historical test records.

## External acceptance still pending

Peerless, BulkVS, and Bandwidth credentials are not available. Their live inventories and actual availability responses have not been verified. No live purchase, disconnect, or port submission was attempted. Carrier contract tests and the browser mock workflows do not substitute for that account-level acceptance.

Password or role changes and user creation were not performed in the browser. The current Users screen lists staff accounts; automated API authorization tests cover protected operations.
