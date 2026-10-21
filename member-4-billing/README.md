# Member 4 — billing

ASP.NET Core/.NET 8 application, deployed independently as `subscription`, `payment` and `invoice`. Each role owns a separate MySQL database. RabbitMQ carries billing commands/results; Kafka carries business events.

```powershell
cd member-4-billing
dotnet test tests/Billing.Tests.csproj
dotnet publish Billing.csproj -c Release
docker build -t streaming-billing .
```

`SERVICE_NAME` and `PORT` select the role. Compose supplies the database, Keycloak, Profile and broker configuration. Initial migrations are idempotent; future released schema changes must be new migration files with an explicit migration runner.

## Implemented local behavior

- Public plan listing; account-scoped subscriptions, payments and invoices.
- Persistent subscribe workflow with account locks and request-hash idempotency.
- Persistent RabbitMQ commands and manual acknowledgments.
- Per-destination outbox obligations for payment replies and Kafka events.
- A **local payment simulator** with stable provider-operation records.
- Simulated timeout-after-charge, lookup reconciliation and decline behavior.
- Immediate cancellation and late-success refund compensation.
- Entitlement lookup for Playback.
- Invoice/credit records deduplicated by financial effect.
- Downloadable PDF explicitly marked as a local sandbox document.

Example subscription body: `{"planId":"premium","simulateTimeout":true}` with an `Idempotency-Key` header. `decline:true` simulates a definitive decline. No card data is collected and no real money is charged.

The local billing policy charges a fixed INR amount for 30 days. Cancellation is immediate, with no ordinary prorated refund. A successful charge arriving after pending cancellation triggers compensation. These are demo policies, not accepted production accounting rules.

## Next work

Complete provider/webhook adapters, stored payment methods, support refund authorization, plan changes, proration, renewal/dunning, saga deadlines, real invoice numbering, durable PDF jobs/object storage, privacy retention and reconciliation reporting from the original plan. The simulator is not a verified provider integration.

Member 5 consumes entitlement. Member 1 owns broker/environment integration. Only modify this member folder.
