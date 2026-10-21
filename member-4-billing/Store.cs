using MySqlConnector;

namespace Billing;

public sealed class Store(string connectionString)
{
    public async Task<MySqlConnection> Open() { var c = new MySqlConnection(connectionString); await c.OpenAsync(); return c; }
    public async Task Init() { await using var c = await Open(); foreach (var statement in File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "migrations/001_initial.sql")).Split(';', StringSplitOptions.RemoveEmptyEntries)) { await new MySqlCommand(statement, c).ExecuteNonQueryAsync(); } }
    public async Task<T> Locked<T>(string id, Func<Tx, Task<T>> work)
    {
        await using var c = await Open(); await using var t = await c.BeginTransactionAsync(); var tx = new Tx(c, t);
        await tx.Execute("INSERT IGNORE INTO locks(id) VALUES (@id)", ("id", id));
        await tx.Scalar("SELECT id FROM locks WHERE id=@id FOR UPDATE", ("id", id));
        var result = await work(tx); await t.CommitAsync(); return result;
    }
    public async Task<List<State>> List(string? account = null, string? kind = null)
    {
        await using var c = await Open(); var cmd = new MySqlCommand("SELECT body FROM records WHERE (@account IS NULL OR account_id=@account) AND (@kind IS NULL OR kind=@kind) ORDER BY id LIMIT 100", c);
        cmd.Parameters.AddWithValue("account", account ?? (object)DBNull.Value); cmd.Parameters.AddWithValue("kind", kind ?? (object)DBNull.Value);
        await using var r = await cmd.ExecuteReaderAsync(); var result = new List<State>(); while (await r.ReadAsync()) result.Add(Rules.Parse<State>(r.GetString(0))); return result;
    }
    public async Task<State?> Get(string id) { await using var c = await Open(); var cmd = new MySqlCommand("SELECT body FROM records WHERE id=@id", c); cmd.Parameters.AddWithValue("id", id); var value = await cmd.ExecuteScalarAsync(); return value is string text ? Rules.Parse<State>(text) : null; }
}

public sealed class Tx(MySqlConnection connection, MySqlTransaction transaction)
{
    MySqlCommand Cmd(string sql, params (string, object)[] args) { var c = new MySqlCommand(sql, connection, transaction); foreach (var (k, v) in args) c.Parameters.AddWithValue(k, v); return c; }
    public Task<int> Execute(string sql, params (string, object)[] args) => Cmd(sql, args).ExecuteNonQueryAsync();
    public Task<object?> Scalar(string sql, params (string, object)[] args) => Cmd(sql, args).ExecuteScalarAsync();
    public async Task<State?> Get(string id) { var value = await Scalar("SELECT body FROM records WHERE id=@id", ("id", id)); return value is string s ? Rules.Parse<State>(s) : null; }
    public Task<int> Put(State s) => Execute("INSERT INTO records(id,account_id,kind,body) VALUES (@id,@account,@kind,@body) ON DUPLICATE KEY UPDATE body=@body", ("id", s.Id), ("account", s.AccountId), ("kind", s.Kind), ("body", Rules.Serialize(s)));
    public Task<int> Outbox(string id, string destination, string transport, object payload) => Execute("INSERT IGNORE INTO outbox(id,destination,transport,payload) VALUES (@id,@destination,@transport,@payload)", ("id", id), ("destination", destination), ("transport", transport), ("payload", Rules.Serialize(payload)));
    public async Task<bool> Seen(string id) => await Scalar("SELECT id FROM inbox WHERE id=@id", ("id", id)) is not null;
    public Task<int> Mark(string id) => Execute("INSERT IGNORE INTO inbox(id) VALUES (@id)", ("id", id));
}
