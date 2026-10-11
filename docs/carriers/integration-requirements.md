# Carrier adapter integration requirements

Phase 4 adds a carrier registry with typed ports for inventory, search, purchase, disconnect, portability, port submission, order status, and port documents. The registry resolves a capability for a carrier account or throws a structured `unsupported` error. A carrier can advertise a capability only when its matching implementation exists. `MockCarrierAdapter` is an explicit deterministic test fixture and is not registered in the running API.

## Implemented provider paths

| Provider | Enabled capability | Contract source | Status |
| --- | --- | --- | --- |
| Bandwidth | Read-only in-service inventory via JSON Numbers API v2 | [My Numbers API](https://dev.bandwidth.com/apis/numbers-apis/my-numbers/) | Implemented and contract-tested with intercepted transport; requires account ID and credentials for live verification |
| BulkVS | None | [Developer overview](https://www.bulkvs.com/developers.html), [SOAP guide](https://portal.bulkvs.com/assets/images/API-SOAP-HOWTO.pdf) | Adapter registered; account WSDL and operation contracts needed before enabling |
| Peerless | None | No WSDL supplied | Adapter registered; WSDL and account access needed before enabling |

Bandwidth inventory uses `GET https://api.bandwidth.com/api/v2/accounts/{accountId}/inserviceNumbers`, Basic authentication, bounded page size, and the documented `phoneNumbers`, `totalCount`, and `links.next` fields. Pagination follows only a validated page token from the documented host and account path. Native phone numbers are normalized to E.164. No live Bandwidth call has been made.

## Secrets and failure handling

Carrier account records contain a `credentialRef`, not a password. For reference `BANDWIDTH_MAIN`, the API reads `DATAPHONE_CARRIER_BANDWIDTH_MAIN_USERNAME` and `DATAPHONE_CARRIER_BANDWIDTH_MAIN_PASSWORD` from its process environment. Supply these through a deployment secret manager; keep them out of Git, URL query strings, logs, and API responses. The registry service does not register a production mock.

Outbound requests use HTTPS, reject redirects, time out after 10 seconds by default, and cap JSON responses at 1 MB. HTTP 401/403 map to authentication errors; 429 maps to a retryable rate-limit error carrying a bounded `Retry-After` delay; 408/504 map to timeouts; 5xx map to retryable upstream failures. Consumers should schedule a delayed job from `retryAfterMs` rather than immediately repeating a 429 request. No carrier-specific request quota is assumed without account documentation. Errors contain no response body or credential value.

## Before enabling other operations

Obtain the exact provider operation contract, sandbox credentials, account permissions, status/error samples, request limits, idempotency behavior, and billing/release implications. For Peerless, obtain its WSDL and endpoint details. For BulkVS, obtain the account WSDL and confirm the SOAP method, field, authentication, and error contracts for each intended operation. For Bandwidth write operations, confirm current account-specific API version, product configuration, order and callback semantics, and idempotency before implementation. Real purchase, disconnect, and port submission remain disabled pending separate operational authorization.
