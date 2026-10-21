using System.Security.Claims;
using System.Text.Json;
using Billing;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);
string Required(string key) => builder.Configuration[key] ?? throw new InvalidOperationException($"Missing {key}");
var service = Required("SERVICE_NAME");
if (!new[] { "subscription", "payment", "invoice" }.Contains(service)) throw new InvalidOperationException("Invalid service");
builder.WebHost.UseUrls($"http://0.0.0.0:{Required("PORT")}");
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow);
builder.Services.AddSingleton(new Store(Required("DATABASE_URL")));
builder.Services.AddHttpClient("authority", c => c.Timeout = TimeSpan.FromMilliseconds(1000));
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
{
    o.MetadataAddress = Required("JWT_METADATA_URL"); o.RequireHttpsMetadata = false; o.MapInboundClaims = false;
    o.TokenValidationParameters = new TokenValidationParameters { ValidateIssuer = true, ValidIssuer = Required("JWT_ISSUER"), ValidateAudience = true, ValidAudience = "streaming", ValidateLifetime = true, ValidAlgorithms = [SecurityAlgorithms.RsaSha256], ClockSkew = TimeSpan.FromSeconds(10) };
});
builder.Services.AddAuthorization(); builder.Services.AddHostedService<Workers>();
var app = builder.Build();
await app.Services.GetRequiredService<Store>().Init();
app.Use(async (ctx, next) => { try { await next(); } catch (Problem e) { ctx.Response.StatusCode = e.Status; await ctx.Response.WriteAsJsonAsync(new { type = "about:blank", title = e.Message, status = e.Status }); } catch (Exception) { ctx.Response.StatusCode = 503; await ctx.Response.WriteAsJsonAsync(new { type = "about:blank", title = "Service unavailable", status = 503 }); } });
app.UseAuthentication(); app.UseAuthorization();
app.MapGet("/health/live", () => new { status = "ok", service });
app.MapGet("/health/ready", async (Store db) => { await using var c = await db.Open(); return new { status = "ok", service }; });
async Task<string> Account(HttpContext ctx)
{
    var sub = ctx.User.FindFirstValue("sub") ?? throw new Problem(401, "Access token required");
    var client = app.Services.GetRequiredService<IHttpClientFactory>().CreateClient("authority");
    using var request = new HttpRequestMessage(HttpMethod.Get, Required("PROFILE_URL") + "/internal/account"); request.Headers.Add("Authorization", ctx.Request.Headers.Authorization.ToString()); request.Headers.Add("X-Service-Key", Required("SERVICE_KEY"));
    using var response = await client.SendAsync(request); if (!response.IsSuccessStatusCode) throw new Problem(response.StatusCode == System.Net.HttpStatusCode.Forbidden ? 403 : 503, "Account authority unavailable"); return sub;
}
void Workload(HttpContext ctx) { var given = ctx.Request.Headers["X-Service-Key"].ToString(); if (!System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(System.Text.Encoding.UTF8.GetBytes(given), System.Text.Encoding.UTF8.GetBytes(Required("SERVICE_KEY")))) throw new Problem(403, "Workload identity required"); }

if (service == "subscription")
{
    app.MapGet("/plans", () => new { items = Rules.Plans });
    app.MapPost("/subscriptions", async (SubscribeInput input, HttpContext ctx, Store db) =>
    {
        var account = await Account(ctx); var key = ctx.Request.Headers["Idempotency-Key"].ToString(); if (key.Length is < 1 or > 128) throw new Problem(400, "Idempotency-Key required (1..128 characters)");
        var plan = Rules.Plans.FirstOrDefault(p => p.Id == input.PlanId) ?? throw new Problem(400, "Unknown plan");
        var hash = Rules.Hash(Rules.Serialize(input)); var idem = Rules.Hash(account + "/subscribe/" + key);
        var result = await db.Locked(account, async tx =>
        {
            var oldHash = await tx.Scalar("SELECT request_hash FROM idempotency WHERE id=@id", ("id", idem));
            if (oldHash is string old) { Rules.SameRequest(old, hash); var resource = (string)(await tx.Scalar("SELECT resource_id FROM idempotency WHERE id=@id", ("id", idem)))!; return (await tx.Get(resource))!; }
            var active = await tx.Scalar("SELECT id FROM records WHERE account_id=@id AND kind='subscription' AND JSON_UNQUOTE(body->'$.status') IN ('PENDING','ACTIVE','REFUND_PENDING') LIMIT 1", ("id", account)); if (active is not null) throw new Problem(409, "A live subscription already exists");
            var id = Guid.NewGuid().ToString(); var s = new State { Id = id, AccountId = account, Kind = "subscription", PlanId = plan.Id, Amount = plan.Amount, Currency = plan.Currency, PaymentId = "pay:" + id, ValidUntil = DateTimeOffset.UtcNow.AddDays(30), MaxStreams = plan.MaxStreams, MaxQuality = plan.MaxQuality };
            await tx.Put(s); await tx.Execute("INSERT INTO idempotency(id,request_hash,resource_id) VALUES (@id,@hash,@resource)", ("id", idem), ("hash", hash), ("resource", id));
            var command = new Command("charge:" + s.PaymentId, id, account, id, s.PaymentId, s.Amount, s.Currency, SimulateTimeout: input.SimulateTimeout, Decline: input.Decline); await tx.Outbox(command.Id, "payment.charge", "rabbit", command); return s;
        }); return Results.Accepted("/subscriptions/" + result.Id, result);
    }).RequireAuthorization();
    app.MapGet("/subscriptions", async (HttpContext ctx, Store db) => new { items = await db.List(await Account(ctx), "subscription") }).RequireAuthorization();
    app.MapGet("/subscriptions/current", async (HttpContext ctx, Store db) => { var items = await db.List(await Account(ctx), "subscription"); return Results.Json(items.LastOrDefault(s => s.Status is "ACTIVE" or "PENDING")); }).RequireAuthorization();
    app.MapGet("/internal/entitlement", async (HttpContext ctx, Store db) => { Workload(ctx); var list = await db.List(await Account(ctx), "subscription"); var s = list.FirstOrDefault(x => x.Status == "ACTIVE" && x.ValidUntil > DateTimeOffset.UtcNow); return new { active = s is not null, maxStreams = s?.MaxStreams ?? 0, maxQuality = s?.MaxQuality ?? "SD", validUntil = s?.ValidUntil ?? DateTimeOffset.UtcNow, version = s?.Version ?? 0 }; }).RequireAuthorization();
    app.MapPost("/subscriptions/{id}/cancel", async (string id, HttpContext ctx, Store db) => { var account = await Account(ctx); return await db.Locked(account, async tx => { var s = await tx.Get(id); if (s?.AccountId != account) throw new Problem(404, "Subscription not found"); if (s.Status is "CANCELLED" or "REFUND_PENDING") return s; s.Status = "CANCELLED"; s.Version++; await tx.Put(s); await tx.Outbox($"subscription:{id}:{s.Version}", "billing.subscription.v1", "kafka", Rules.Envelope(service, "SubscriptionChanged", $"subscription:{id}:{s.Version}", account, s.Version, s)); return s; }); }).RequireAuthorization();
}
if (service == "payment")
{
    app.MapGet("/payments", async (HttpContext ctx, Store db) => new { items = await db.List(await Account(ctx), "payment") }).RequireAuthorization();
    app.MapPost("/payments/setup-sessions", async (HttpContext ctx) => new { id = Guid.NewGuid().ToString(), accountId = await Account(ctx), sandbox = true, message = "No cards are collected. Sandbox subscription requests charge a simulated payment method." }).RequireAuthorization();
}
if (service == "invoice")
{
    app.MapGet("/invoices", async (HttpContext ctx, Store db) => new { items = await db.List(await Account(ctx), "invoice") }).RequireAuthorization();
    app.MapGet("/invoices/{id}", async (string id, HttpContext ctx, Store db) => { var account = await Account(ctx); var invoice = await db.Get(id); if (invoice?.AccountId != account) throw new Problem(404, "Invoice not found"); return invoice; }).RequireAuthorization();
    app.MapGet("/invoices/{id}/pdf", async (string id, HttpContext ctx, Store db) => { var account = await Account(ctx); var invoice = await db.Get(id); if (invoice?.AccountId != account) throw new Problem(404, "Invoice not found"); ctx.Response.Headers.CacheControl = "private, no-store"; return Results.File(Pdf.Render(invoice), "application/pdf", "invoice.pdf"); }).RequireAuthorization();
}
app.Run();
