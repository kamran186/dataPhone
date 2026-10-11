# DataPhone API guide

The API prefix is `/api/v1`. Interactive Swagger metadata is served at `/api/docs` when the API is running. Protected endpoints require `Authorization: Bearer <access token>`; the browser also uses a rotating HttpOnly refresh cookie. Errors include an HTTP status and correlation ID. Use the `x-correlation-id` response header for support investigations. All IDs are MongoDB ObjectId strings, and phone numbers use E.164.

| Area | Endpoints | Required permission |
| --- | --- | --- |
| Health | `GET /health/live`, `/health/ready` | Public |
| Auth | `POST /auth/login`, `/auth/refresh`, `/auth/logout` | Session flow |
| Staff | `GET/POST /users`, `PATCH /users/:id`, `PATCH /users/:id/roles`, `GET /roles`, `/permissions` | `users.manage` or `roles.manage` as appropriate |
| Inventory | `GET /numbers`, `/numbers/:id`, `/numbers/export?format=csv\|xlsx`, `GET /carriers`, `POST /carriers/:id/accounts`, `POST /carriers/:accountId/sync`, `GET /reconciliation/issues` | `inventory.view`, `carriers.configure`, `sync.trigger`, or `inventory.manage` |
| Ownership | `GET/POST /customers`, `GET/PATCH /customers/:id`, `GET /customers/:id/numbers`, `POST /assignments`, `/assignments/bulk`, `/assignments/transfer`, `/assignments/unassign`, `GET /numbers/:id/history`, `/customers/:id/history` | Customer, assignment, and audit permissions |
| Purchases | `GET /purchases/search`, `GET/POST /purchases`, `GET /purchases/:id`, `POST /numbers/:id/disconnect`, `GET /disconnects/:id` | `numbers.purchase` or `numbers.disconnect` |
| Ports | `POST /ports/check-portability`, `GET/POST /ports`, `GET/PATCH /ports/:id`, `POST /ports/:id/submit`, `/resubmit`, `/cancel`, `GET/POST /ports/:id/documents`, `GET /ports/:id/documents/:documentId` | `ports.manage` |
| Jobs | `GET /jobs`, `/jobs/:id`, `/jobs/:id/events` | `jobs.view` |
| Reporting | `GET /dashboard`, `/reports/:type`, `/reports/:type/export?format=csv\|xlsx` | `reports.view` |

Reports accept `page`, `pageSize`, and `search`. Report types are `all-dids`, `by-carrier`, `by-customer`, `unassigned`, `assignment-history`, `purchase-history`, `open-ports`, and `sync-failures`. Exports stop at 10,000 rows. Number inventory has its own search, carrier, customer, status, sort, and pagination filters.

Create a port draft with customer and carrier account IDs, `numbers`, `currentProvider`, `accountName`, `accountNumber`, `pin`, and `serviceAddress` (`line1`, optional `line2`, `city`, `region`, `postalCode`). Secret values are encrypted and never returned. Document upload accepts a JSON body with `filename`, `contentType`, and base64 `base64`; supported formats are PDF, PNG, and JPEG up to 5 MB. A port detail response includes status, native status, FOC date, redacted account-field presence, and history. `DATE_CONFIRMED` means the port remains in progress. Live port submission is disabled.

`GET /jobs/:id/events` is a protected Server-Sent Events stream. Send `Last-Event-ID` to resume persisted events after a disconnect. Background operations return a job ID for progress tracking. Jobs can be queued, running, succeeded, or failed; downstream orders and ports have their own business statuses.
