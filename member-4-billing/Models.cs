using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Billing;

public sealed class State
{
    public string Id { get; set; } = "";
    public string AccountId { get; set; } = "";
    public string Kind { get; set; } = "";
    public string PlanId { get; set; } = "";
    public string Status { get; set; } = "PENDING";
    public int Version { get; set; } = 1;
    public string PaymentId { get; set; } = "";
    public string SubscriptionId { get; set; } = "";
    public long Amount { get; set; }
    public string Currency { get; set; } = "INR";
    public int MaxStreams { get; set; } = 1;
    public string MaxQuality { get; set; } = "HD";
    public DateTimeOffset ValidUntil { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public bool SimulateTimeout { get; set; }
    public bool Decline { get; set; }
}
public record Plan(string Id, long Amount, string Currency, int MaxStreams, string MaxQuality);
public record SubscribeInput(string PlanId, bool SimulateTimeout = false, bool Decline = false);
public record Command(string Id, string SagaId, string AccountId, string SubscriptionId, string PaymentId, long Amount, string Currency, string Status = "", bool SimulateTimeout = false, bool Decline = false);
public record Event(string Specversion, string Id, string Source, string Type, string Subject, DateTimeOffset Time, int Version, object Data);
public sealed class Problem(int status, string message) : Exception(message) { public int Status { get; } = status; }

public static class Rules
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public static readonly Plan[] Plans = [new("basic", 19900, "INR", 1, "HD"), new("premium", 49900, "INR", 4, "UHD")];
    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    public static string Serialize(object value) => JsonSerializer.Serialize(value, Json);
    public static T Parse<T>(string value) => JsonSerializer.Deserialize<T>(value, Json)!;
    public static void SameRequest(string existingHash, string requestHash) { if (existingHash != requestHash) throw new Problem(409, "Idempotency key reused with different request"); }
    public static string ResultStatus(string current, string result) => current switch
    {
        "CANCELLED" => result == "SUCCEEDED" ? "REFUND_PENDING" : "CANCELLED",
        "REFUND_PENDING" => "REFUND_PENDING",
        "ACTIVE" => "ACTIVE",
        _ => result == "SUCCEEDED" ? "ACTIVE" : result == "FAILED" ? "FAILED" : current
    };
    public static Event Envelope(string source, string type, string id, string subject, int version, object data) => new("1.0", id, source, type, subject, DateTimeOffset.UtcNow, version, data);
}
