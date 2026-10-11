# Carrier capability matrix

**Documented** means a public provider source describes the capability. **Unknown** means the available material does not establish it. No capability has been validated against DataPhone's account.

| Capability | Peerless Network | BulkVS | Bandwidth |
| --- | --- | --- | --- |
| Held-number inventory | Unknown: WSDL absent | Unknown from public overview | Documented: in-service numbers |
| Available-number search | Unknown | Documented in public overview | Documented: number acquisition |
| Purchase/order | Unknown | Documented: number ordering | Documented: new number orders |
| Disconnect/delete | Unknown | Documented: number deleting | Documented: disconnect orders |
| Portability check | Unknown | Documented in public overview | Documented: LNP checker |
| Inbound port submission | Unknown | Unknown from public overview | Documented: port-ins |
| Order/status tracking | Unknown | Unknown from public overview | Documented: asynchronous order model |
| Port document upload | Unknown | Unknown from public overview | Documented: port-in LOA upload |

Sources checked 2026-10-11: [BulkVS developer overview](https://www.bulkvs.com/developers.html), [BulkVS API service FAQ](https://www.bulkvs.com/faqs/api-services.php), [Bandwidth Numbers APIs](https://dev.bandwidth.com/apis/numbers-apis/), [Bandwidth Numbers overview](https://dev.bandwidth.com/docs/numbers/), [Bandwidth port-ins](https://dev.bandwidth.com/docs/numbers/porting/port-ins/), and [Bandwidth order model](https://dev.bandwidth.com/docs/numbers/porting/orderModel/).

No Peerless WSDL was present; its SOAP operations must not be invented. BulkVS's public overview does not establish account permissions, request/response contracts, or idempotency semantics. Bandwidth documents endpoints, but DataPhone account access and production behavior remain unverified. Mock adapters must be labeled as mocks.
