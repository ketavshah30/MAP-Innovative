using System.Text;
using System.Text.Json;
using Confluent.Kafka;
using RabbitMQ.Client;
using MySqlConnector;

namespace Billing;

public sealed class Workers(Store store, IConfiguration config, ILogger<Workers> log) : BackgroundService
{
    string Service => config["SERVICE_NAME"]!;
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        while (!stop.IsCancellationRequested)
        {
            try
            {
                using var rabbit = new ConnectionFactory { Uri = new Uri(config["RABBIT_URL"]!), RequestedConnectionTimeout = TimeSpan.FromSeconds(5) }.CreateConnection();
                using var channel = rabbit.CreateModel(); channel.ConfirmSelect();
                foreach (var queue in new[] { "payment.charge", "payment.refund", "subscription.payment-result" }) channel.QueueDeclare(queue, true, false, false, new Dictionary<string, object> { { "x-queue-type", "quorum" } });
                using var producer = new ProducerBuilder<string, string>(new ProducerConfig { BootstrapServers = config["KAFKA_BROKERS"], EnableIdempotence = true, Acks = Acks.All }).Build();
                using var consumer = Service == "invoice" ? new ConsumerBuilder<string, string>(new ConsumerConfig { BootstrapServers = config["KAFKA_BROKERS"], GroupId = "invoice-v1", AutoOffsetReset = AutoOffsetReset.Earliest, EnableAutoCommit = false, IsolationLevel = IsolationLevel.ReadCommitted }).Build() : null;
                consumer?.Subscribe("billing.payment.v1");
                while (!stop.IsCancellationRequested)
                {
                    await Relay(channel, producer, stop);
                    if (Service == "payment")
                    {
                        await Poll(channel, "payment.charge", HandleCharge);
                        await Poll(channel, "payment.refund", HandleRefund);
                        foreach (var p in (await store.List(kind: "payment")).Where(p => p.Status == "UNKNOWN")) await Reconcile(p);
                    }
                    if (Service == "subscription") await Poll(channel, "subscription.payment-result", HandleResult);
                    if (consumer is not null)
                    {
                        var e = consumer.Consume(TimeSpan.FromMilliseconds(50));
                        if (e is not null) { await HandleInvoice(e.Message.Value); consumer.Commit(e); }
                    }
                    await Task.Delay(250, stop);
                }
                consumer?.Close();
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { break; }
            catch (Exception ex) { log.LogWarning("{Service} worker paused: {Category}", Service, ex.GetType().Name); try { await Task.Delay(2000, stop); } catch (OperationCanceledException) { break; } }
        }
    }
    async Task Relay(IModel channel, IProducer<string, string> producer, CancellationToken stop)
    {
        var rows = new List<(string Id, string Destination, string Transport, string Payload)>();
        await using (var c = await store.Open()) { var cmd = new MySqlCommand("SELECT id,destination,transport,payload FROM outbox WHERE sent=false ORDER BY created_at,id LIMIT 50", c); await using var reader = await cmd.ExecuteReaderAsync(stop); while (await reader.ReadAsync(stop)) rows.Add((reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3))); }
        foreach (var row in rows)
        {
            if (row.Transport == "rabbit") { var props = channel.CreateBasicProperties(); props.Persistent = true; props.MessageId = row.Id; props.ContentType = "application/json"; channel.BasicPublish("", row.Destination, true, props, Encoding.UTF8.GetBytes(row.Payload)); channel.WaitForConfirmsOrDie(TimeSpan.FromSeconds(5)); }
            else { using var e = JsonDocument.Parse(row.Payload); await producer.ProduceAsync(row.Destination, new Message<string, string> { Key = e.RootElement.GetProperty("subject").GetString() ?? throw new InvalidOperationException("Event subject required"), Value = row.Payload }, stop); }
            await using var c = await store.Open(); var update = new MySqlCommand("UPDATE outbox SET sent=true WHERE id=@id", c); update.Parameters.AddWithValue("id", row.Id); await update.ExecuteNonQueryAsync(stop);
        }
    }
    static async Task Poll(IModel channel, string queue, Func<Command, Task> handler)
    {
        var delivery = channel.BasicGet(queue, false); if (delivery is null) return;
        try { await handler(Rules.Parse<Command>(Encoding.UTF8.GetString(delivery.Body.Span))); channel.BasicAck(delivery.DeliveryTag, false); } catch { channel.BasicNack(delivery.DeliveryTag, false, true); throw; }
    }
    async Task PublishResult(Tx tx, State payment)
    {
        var reply = new Command($"result:{payment.Id}:{payment.Status}", payment.SubscriptionId, payment.AccountId, payment.SubscriptionId, payment.Id, payment.Amount, payment.Currency, payment.Status);
        await tx.Outbox(reply.Id, "subscription.payment-result", "rabbit", reply);
        await tx.Outbox($"event:{payment.Id}:{payment.Status}", "billing.payment.v1", "kafka", Rules.Envelope("payment", "Payment" + payment.Status, $"event:{payment.Id}:{payment.Status}", payment.SubscriptionId, payment.Version, payment));
    }
    async Task HandleCharge(Command command)
    {
        if (command.Amount <= 0) throw new Problem(400, "Invalid charge amount");
        await store.Locked(command.AccountId, async tx =>
        {
            if (await tx.Seen(command.Id)) return 0;
            var payment = await tx.Get(command.PaymentId);
            if (payment is null)
            {
                payment = new State { Id = command.PaymentId, AccountId = command.AccountId, Kind = "payment", SubscriptionId = command.SubscriptionId, Amount = command.Amount, Currency = command.Currency, Status = command.Decline ? "FAILED" : command.SimulateTimeout ? "UNKNOWN" : "SUCCEEDED" };
                // This is a persistent local provider simulator, not a network payment integration.
                var provider = new State { Id = "provider:" + command.PaymentId, AccountId = command.AccountId, Kind = "provider", Amount = command.Amount, Currency = command.Currency, Status = command.Decline ? "FAILED" : "SUCCEEDED" };
                await tx.Put(provider); await tx.Put(payment);
            }
            if (payment.Status != "UNKNOWN") await PublishResult(tx, payment);
            await tx.Mark(command.Id); return 0;
        });
    }
    async Task Reconcile(State original)
    {
        await store.Locked(original.AccountId, async tx => { var p = await tx.Get(original.Id); if (p?.Status != "UNKNOWN") return 0; var provider = await tx.Get("provider:" + p.Id); if (provider is null) return 0; p.Status = provider.Status; p.Version++; await tx.Put(p); await PublishResult(tx, p); return 0; });
    }
    async Task HandleRefund(Command command)
    {
        await store.Locked(command.AccountId, async tx =>
        {
            if (await tx.Seen(command.Id)) return 0; var p = await tx.Get(command.PaymentId) ?? throw new Problem(404, "Payment not found");
            if (p.Status == "UNKNOWN") throw new Problem(409, "Reconcile payment first");
            if (p.Status == "SUCCEEDED") { p.Status = "REFUNDED"; p.Version++; await tx.Put(p); await PublishResult(tx, p); }
            await tx.Mark(command.Id); return 0;
        });
    }
    async Task HandleResult(Command command)
    {
        await store.Locked(command.AccountId, async tx =>
        {
            if (await tx.Seen(command.Id)) return 0;
            var s = await tx.Get(command.SubscriptionId) ?? throw new Problem(404, "Subscription not found");
            if (command.Status == "REFUNDED") s.Status = "CANCELLED";
            else s.Status = Rules.ResultStatus(s.Status, command.Status);
            s.Version++;
            if (s.Status == "REFUND_PENDING") await tx.Outbox("refund:" + s.PaymentId, "payment.refund", "rabbit", new Command("refund:" + s.PaymentId, s.Id, s.AccountId, s.Id, s.PaymentId, s.Amount, s.Currency));
            await tx.Put(s); await tx.Mark(command.Id);
            await tx.Outbox($"subscription:{s.Id}:{s.Version}", "billing.subscription.v1", "kafka", Rules.Envelope("subscription", "SubscriptionChanged", $"subscription:{s.Id}:{s.Version}", s.AccountId, s.Version, s)); return 0;
        });
    }
    async Task HandleInvoice(string payload)
    {
        var e = JsonDocument.Parse(payload).RootElement; var id = e.GetProperty("id").GetString()!; var payment = Rules.Parse<State>(e.GetProperty("data").GetRawText());
        if (payment.Status is not ("SUCCEEDED" or "REFUNDED")) return;
        await store.Locked(payment.AccountId, async tx => { if (await tx.Seen(id)) return 0; var invoice = new State { Id = $"invoice:{payment.Id}:{payment.Status}", AccountId = payment.AccountId, Kind = "invoice", PaymentId = payment.Id, Amount = payment.Amount, Currency = payment.Currency, Status = payment.Status == "REFUNDED" ? "CREDIT" : "READY" }; await tx.Put(invoice); await tx.Mark(id); return 0; });
    }
}
