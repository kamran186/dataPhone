# Operator guide

Sign in with an administrator-created account. The left navigation only shows pages your role can use; the API checks permissions separately. Super Admin manages users and roles. Operations staff can work with inventory, customers, purchases, ports, jobs, and reports according to the seeded role permissions.

## Daily workflow

1. Open **Overview** for DID counts, open ports, pending purchases, failed jobs, and carrier sync state. **Potentially unused** means an active number without a customer assignment. It does not prove that the number is unbilled or unrouted.
2. In **Inventory**, search numbers and inspect their carrier, account, status, customer assignment, and history. Authorized staff can assign, transfer, or unassign numbers. Review reconciliation issues before resolving carrier conflicts.
3. In **Customers**, create and maintain customer records, then inspect each customer's numbers and history.
4. Use **Search numbers** to compare live availability. Area code works across all three carriers; other filters may be unsupported by a carrier and the screen explains that outcome. A partial result means the exchange search reached its request limit. In **Purchases**, choose a customer for a simulated order. Only an explicitly enabled local mock carrier can accept an order. The API blocks real billable purchases. Watch the order and job progress before treating a number as held and assigned.
5. In **Ports**, create a draft, select the customer and destination account, enter the current provider, account details, service address, and numbers, then upload PDF/PNG/JPEG evidence. Sensitive fields are encrypted and not shown again. Correct a draft or a rejected request before resubmitting. The local mock moves through a confirmed FOC date and later completion; a FOC date alone is **not** a completed port. Only completed numbers enter inventory and gain customer assignment.
6. In **Reports**, select one of eight operational reports, search, and download CSV or Excel. Exports above 10,000 rows require a narrower search.

The **Jobs** screen shows durable job status and live progress. A failed job or open reconciliation issue needs review; do not infer that an external provider completed an operation from a queued job. Port documents are available only to staff with `ports.manage`. Do not paste account numbers, PINs, or document contents into tickets or logs.

## Local mock mode

Set `DATAPHONE_ENABLE_MOCK_CARRIER=true` only in a nonproduction environment and restart the API. The mock carrier is then seeded. Configure a carrier account for it, using an external account ID such as `sandbox`, before searching offers or drafting ports. Mock operations never call a provider or incur charges. The flag is ignored in production. Real carrier submissions remain disabled even if a carrier account is configured.
