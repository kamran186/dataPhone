# Carrier integration requirements

| Carrier | Enabled live capabilities | Implementation source |
| --- | --- | --- |
| Peerless | Inventory, available-number search | Supplied [service WSDL](contracts/peerless/APIService.wsdl) and [port type WSDL](contracts/peerless/APIServicePortType.wsdl) |
| BulkVS | Inventory, available-number search | [REST OpenAPI](https://portal.bulkvs.com/api/v1.0/openapi) |
| Bandwidth | Inventory, available-number search | [My Numbers v2](https://dev.bandwidth.com/apis/numbers-apis/my-numbers/), [Numbers v2](https://dev.bandwidth.com/apis/numbers-apis/numbers/) |

Peerless uses `getTnInventoryReport` and `searchNumbers` at the endpoint supplied in the WSDL. SOAP operation names are allowlisted; the adapter cannot submit an order. The checked-in WSDLs have matching import filenames. XML parsing rejects DTDs/entities and does not coerce phone numbers into numeric values. The report is normalized as numbers held in the carrier account; provider-specific status semantics still require live validation.

BulkVS uses `GET /tnRecord` without Number or Limit to retrieve all account entries, as documented. There is no documented cursor. A response exceeding the bounded size fails the sync; it is never silently truncated. Compare the returned count with the account portal during acceptance, particularly for large accounts. Search uses `/exchanges?Search=NPA` then `GET /orderTn` with NPA and NXX, at most ten exchange calls per search. Incomplete exchange coverage is labeled partial. A search 404 means no offers; an inventory 404 fails synchronization.

Bandwidth uses JSON `GET /api/v2/accounts/{accountId}/inserviceNumbers` and `/availableNumbers`. It validates pagination host/account paths, normalizes E.164, and searches USA numbers. Supported filters include area code, state, city with state, and numeric vanity/suffix terms. `*1000` means a suffix search. Peerless supports area code, state, location, and numeric vanity digits without wildcard syntax. BulkVS supports area code only. Unsupported filters are surfaced rather than discarded.

## Account configuration and secrets

An administrator obtains carrier UUIDs from `GET /api/v1/carriers`, then calls `POST /api/v1/carriers/{carrierId}/accounts` with `externalAccountId` and `credentialRef`. Bandwidth requires its real account ID; use the client's carrier account identifier for Peerless and BulkVS. Account references must be distinct when credentials address different inventories. Use the resulting local account UUID with `POST /api/v1/carriers/{accountId}/sync`; the sync is also scheduled hourly. Account configuration is available through the API; inventory and sync state are displayed in the application.

For credential reference `BANDWIDTH_MAIN`, inject `DATAPHONE_CARRIER_BANDWIDTH_MAIN_USERNAME` and `_PASSWORD`. For `PEERLESS_MAIN`, `_USERNAME` means WSDL `userId`, `_PASSWORD` means `passCode`, and `_CUSTOMER` is required. BulkVS supports `_USERNAME`/`_PASSWORD` as Basic API credentials or `_AUTHORIZATION` containing the exact Basic/Bearer authorization supplied for the account. The public BulkVS spec does not define authentication; confirm the client's credential format during acceptance.

Store secrets in the process environment or a secret manager. Local Compose optionally reads the ignored `.env.carriers` file. No password, SOAP body, Authorization header, or provider error body is logged or returned. Account API responses expose only references and status.

## Limits and acceptance

HTTPS is required, redirects are rejected, requests are bounded, and inventory responses are capped at 32 MB for providers without pagination. Bandwidth pages and search responses are capped at 1 MB. Inventory synchronization is capped at 100,000 unique numbers and 1,000 pages. Authentication, rate-limit, timeout, configuration, and upstream errors are sanitized. Jobs retry transient failures with backoff. Missing credentials fail without changing held numbers.

A full snapshot is read before any reconciliation writes. Count changes, count mismatches, empty continuation pages, repeated tokens, malformed records, oversized responses, and transport failures reject the snapshot before marking numbers missing.

Contract tests verify the documented wire formats and failure handling. Test credentials are not yet available. Before live acceptance, verify all account endpoints/permissions, compare complete inventory counts with the portals, search one supported query per carrier, and confirm account-specific error/status behavior. The Peerless WSDL endpoint and BulkVS authentication must be confirmed against those accounts.

Real purchase, disconnect, and port submission remain blocked by both capability registration and service guards. A configured live account never enables these operations. The mock carrier is opt-in for development and cannot be enabled in production.

Client-provided Bandwidth references: [Numbers overview](https://dev.bandwidth.com/docs/numbers/), [migration URL](https://dev.bandwidth.com/docs/numbers/v2/migration), and [search guide](https://dev.bandwidth.com/docs/numbers/guides/searchingForNumbers/). The migration URL was not accessible during review; the current v2 API references above define the implemented paths and response fields. The search guide contains legacy path examples and should not be copied into the v2 adapter.
