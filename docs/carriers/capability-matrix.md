# Carrier capability matrix

This matrix describes the running application's capabilities. All three live providers have contract tests; authenticated account acceptance is pending the client's test credentials.

| Capability | Peerless Network | BulkVS | Bandwidth | Development mock |
| --- | --- | --- | --- | --- |
| Held-number inventory | SOAP report | REST account records | Numbers v2 in-service inventory | Enabled |
| Available-number search | SOAP search | REST NPA/NXX search | Numbers v2 availability | Enabled |
| Live purchase/order | Disabled | Disabled | Disabled | Simulated |
| Live disconnect | Disabled | Disabled | Disabled | Simulated |
| Live portability and inbound ports | Disabled | Disabled | Disabled | Simulated |
| Live order/status tracking and document submission | Disabled | Disabled | Disabled | Simulated |

The [integration guide](integration-requirements.md) documents supported filters, endpoint contracts, secret references, response limits, and live acceptance steps. Peerless contracts are checked in under [contracts/peerless](contracts/peerless/APIService.wsdl). BulkVS uses its [REST OpenAPI](https://portal.bulkvs.com/api/v1.0/openapi). Bandwidth uses the [Numbers v2 references](https://dev.bandwidth.com/apis/numbers-apis/).

A capability is advertised only when its implementation exists. Live write operations are additionally blocked by application guards. Production never registers the development mock.
