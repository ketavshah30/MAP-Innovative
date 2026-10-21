import Fastify, { FastifyRequest } from "fastify";
import { MongoClient, Db, Document, ClientSession } from "mongodb";
import {
  createRemoteJWKSet,
  createLocalJWKSet,
  jwtVerify,
  importPKCS8,
  SignJWT,
  JWTPayload,
} from "jose";
import { Kafka, logLevel } from "kafkajs";
import { readFileSync } from "node:fs";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { Problem, profileInput, pagination, sameAccount } from "./policy.js";

const service = process.argv[2];
if (!["profile", "watchlist"].includes(service))
  throw new Error("Expected profile or watchlist");
const required = (key: string) => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing ${key}`);
  return v;
};
const key = required("SERVICE_KEY");
const issuer = required("JWT_ISSUER");
const accessKeys = createRemoteJWKSet(new URL(required("JWT_JWKS_URL")));
const pctKeys = createLocalJWKSet(
  JSON.parse(readFileSync(required("PCT_JWKS_FILE"), "utf8")),
);
const mongo = new MongoClient(required("MONGO_URL"));
await mongo.connect();
const db = mongo.db(service);
const kafka = new Kafka({
  clientId: service,
  brokers: required("KAFKA_BROKERS").split(","),
  logLevel: logLevel.ERROR,
});
const producer = kafka.producer({ allowAutoTopicCreation: false });
await producer.connect();
const app = Fastify({
  bodyLimit: 65536,
  requestTimeout: 5000,
  logger: {
    redact: [
      "req.headers.authorization",
      "req.headers.x-profile-token",
      "req.headers.x-service-key",
    ],
  },
});
app.setErrorHandler((err, _req, res) => {
  const e = err as Error & {
    status?: number;
    statusCode?: number;
    code?: number | string;
  };
  const status = e.status ?? e.statusCode ?? (e.code === 11000 ? 409 : 500);
  res
    .code(status)
    .type("application/problem+json")
    .send({
      type: "about:blank",
      title: status >= 500 ? "Service unavailable" : e.message,
      status,
    });
});
app.get("/health/live", async () => ({ status: "ok", service }));
app.get("/health/ready", async () => {
  await db.command({ ping: 1 });
  return { status: "ok", service };
});
const collection = (name: string) => db.collection<Document>(name);
async function access(req: FastifyRequest): Promise<JWTPayload> {
  const token = req.headers.authorization?.replace(/^Bearer /, "");
  if (!token) throw new Problem(401, "Bearer token required");
  try {
    const { payload } = await jwtVerify(token, accessKeys, {
      issuer,
      audience: "streaming",
      algorithms: ["RS256"],
    });
    if (!payload.sub) throw Error();
    return payload;
  } catch {
    throw new Problem(401, "Invalid access token");
  }
}
function internal(req: FastifyRequest) {
  const given = String(req.headers["x-service-key"] ?? "");
  if (
    given.length !== key.length ||
    !timingSafeEqual(Buffer.from(given), Buffer.from(key))
  )
    throw new Problem(403, "Workload identity required");
}
async function pct(req: FastifyRequest, sub: string) {
  try {
    const { payload } = await jwtVerify(
      String(req.headers["x-profile-token"] ?? ""),
      pctKeys,
      { issuer: "profile", audience: "streaming", algorithms: ["RS256"] },
    );
    sameAccount(sub, payload.sub);
    return payload;
  } catch {
    throw new Problem(401, "Invalid profile token");
  }
}
async function context(req: FastifyRequest) {
  await access(req);
  let response: Response;
  try {
    response = await fetch(`${required("PROFILE_URL")}/internal/context`, {
      headers: {
        authorization: String(req.headers.authorization),
        "x-profile-token": String(req.headers["x-profile-token"] ?? ""),
        "x-service-key": key,
      },
      signal: AbortSignal.timeout(800),
    });
  } catch {
    throw new Problem(503, "Profile authority unavailable");
  }
  if (!response.ok)
    throw new Problem(
      response.status === 401 || response.status === 403
        ? response.status
        : 503,
      "Profile context unavailable",
    );
  return (await response.json()) as {
    accountId: string;
    profileId: string;
    maturity: number;
    region: string;
  };
}
async function transaction<T>(fn: (session: ClientSession) => Promise<T>) {
  const s = mongo.startSession();
  try {
    return (await s.withTransaction(() => fn(s)))!;
  } finally {
    await s.endSession();
  }
}
function event(type: string, subject: string, version: number, data: unknown) {
  return {
    specversion: "1.0",
    id: randomUUID(),
    source: service,
    type,
    subject,
    time: new Date().toISOString(),
    version,
    data,
  };
}
async function emit(
  session: ClientSession,
  type: string,
  subject: string,
  version: number,
  data: unknown,
) {
  const e = event(type, subject, version, data);
  await collection("outbox").insertOne(
    { _id: e.id as any, topic: "profile.lifecycle.v1", event: e, sent: false },
    { session },
  );
}
let relaying = false;
const relay = setInterval(async () => {
  if (relaying) return;
  relaying = true;
  try {
    for (const row of await collection("outbox")
      .find({ sent: false })
      .limit(50)
      .toArray()) {
      await producer.send({
        topic: row.topic,
        messages: [
          { key: row.event.subject, value: JSON.stringify(row.event) },
        ],
      });
      await collection("outbox").updateOne(
        { _id: row._id },
        { $set: { sent: true } },
      );
    }
  } catch {
    app.log.warn("Outbox delivery pending");
  } finally {
    relaying = false;
  }
}, 500);

if (service === "profile") {
  await collection("profiles").createIndex(
    { accountId: 1, name: 1 },
    { unique: true },
  );
  const privateKey = await importPKCS8(
    readFileSync(required("PCT_PRIVATE_KEY_FILE"), "utf8"),
    "RS256",
  );
  async function account(req: FastifyRequest) {
    const claims = await access(req);
    const id = claims.sub!;
    await collection("accounts").updateOne(
      { _id: id as any },
      { $setOnInsert: { count: 0, disabled: false, version: 1 } },
      { upsert: true },
    );
    const a = await collection("accounts").findOne({ _id: id as any });
    if (!a || a.disabled) throw new Problem(403, "Account disabled");
    return { id, claims, a };
  }
  async function owned(id: string, accountId: string, session?: ClientSession) {
    const p = await collection("profiles").findOne(
      { _id: id as any, accountId, deleted: { $ne: true } },
      { session },
    );
    if (!p) throw new Problem(404, "Profile not found");
    return p;
  }
  app.get("/accounts/me", async (req) => {
    const { id, a } = await account(req);
    return { id, profileCount: a.count, version: a.version };
  });
  app.get("/profiles", async (req) => {
    const { id } = await account(req);
    return {
      items: await collection("profiles")
        .find({ accountId: id, deleted: { $ne: true } })
        .project({ _id: 0 })
        .toArray(),
    };
  });
  app.post("/profiles", async (req, res) => {
    const { id } = await account(req),
      input = profileInput(req.body),
      profileId = randomUUID();
    const result = await transaction(async (session) => {
      const a = await collection("accounts").findOneAndUpdate(
        { _id: id as any, disabled: false, count: { $lt: 5 } },
        { $inc: { count: 1, version: 1 } },
        { session, returnDocument: "after" },
      );
      if (!a)
        throw new Problem(409, "Profile limit reached or account disabled");
      const profile = {
        id: profileId,
        accountId: id,
        ...input,
        version: 1,
        deleted: false,
      };
      await collection("profiles").insertOne(
        { _id: profileId as any, ...profile },
        { session },
      );
      await emit(session, "ProfileCreated", id, a.version, profile);
      return profile;
    });
    return res.code(201).send(result);
  });
  app.get("/profiles/:id", async (req) => {
    const { id } = await account(req);
    const { _id, ...p } = await owned((req.params as any).id, id);
    return p;
  });
  app.patch("/profiles/:id", async (req) => {
    const { id, claims } = await account(req),
      profileId = (req.params as any).id,
      input = profileInput(req.body);
    return transaction(async (session) => {
      const p = await owned(profileId, id, session);
      if (
        input.maturity > p.maturity &&
        !(claims.amr as string[] | undefined)?.includes("mfa")
      )
        throw new Problem(403, "Maturity elevation requires MFA");
      const a = await collection("accounts").findOneAndUpdate(
        { _id: id as any, disabled: false },
        { $inc: { version: 1 } },
        { session, returnDocument: "after" },
      );
      if (!a) throw new Problem(403, "Account disabled");
      const updated = await collection("profiles").findOneAndUpdate(
        { _id: profileId as any, version: p.version },
        { $set: input, $inc: { version: 1 } },
        { session, returnDocument: "after" },
      );
      await emit(session, "ProfileUpdated", id, a.version, updated);
      return updated;
    });
  });
  app.post("/profiles/:id/select", async (req) => {
    const { id } = await account(req),
      p = await owned((req.params as any).id, id);
    // Local demo: account access token is the adult credential. PIN/device separation is a production gate.
    const token = await new SignJWT({
      profileId: p.id,
      maturity: p.maturity,
      policyVersion: p.version,
      region: process.env.DEV_REGION ?? "IN",
    })
      .setProtectedHeader({ alg: "RS256", kid: "local-pct-1" })
      .setSubject(id)
      .setIssuer("profile")
      .setAudience("streaming")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    return { token, expiresIn: 300 };
  });
  app.delete("/profiles/:id", async (req, res) => {
    const { id } = await account(req),
      profileId = (req.params as any).id;
    await transaction(async (session) => {
      await owned(profileId, id, session);
      const a = await collection("accounts").findOneAndUpdate(
        { _id: id as any, disabled: false },
        { $inc: { count: -1, version: 1 } },
        { session, returnDocument: "after" },
      );
      if (!a) throw new Problem(403, "Account disabled");
      await collection("profiles").updateOne(
        { _id: profileId as any },
        {
          $set: { deleted: true, name: `deleted-${profileId}` },
          $inc: { version: 1 },
        },
        { session },
      );
      await emit(session, "ProfileDeleted", id, a.version, {
        accountId: id,
        profileIds: [profileId],
        deleted: true,
      });
    });
    return res.code(204).send();
  });
  app.delete("/accounts/me", async (req, res) => {
    const { id } = await account(req);
    await transaction(async (session) => {
      const profiles = await collection("profiles")
        .find({ accountId: id, deleted: { $ne: true } }, { session })
        .toArray();
      const a = await collection("accounts").findOneAndUpdate(
        { _id: id as any },
        { $set: { disabled: true, count: 0 }, $inc: { version: 1 } },
        { session, returnDocument: "after" },
      );
      await collection("profiles").updateMany(
        { accountId: id },
        { $set: { deleted: true }, $inc: { version: 1 } },
        { session },
      );
      await emit(session, "AccountDeleted", id, a!.version, {
        accountId: id,
        profileIds: profiles.map((p) => p.id),
        deleted: true,
      });
    });
    return res.code(202).send({ status: "deletion-pending" });
  });
  app.get("/internal/context", async (req) => {
    internal(req);
    const { id } = await account(req),
      token = await pct(req, id),
      p = await owned(String(token.profileId), id);
    if (p.version !== token.policyVersion)
      throw new Problem(401, "Profile policy changed; select profile again");
    return {
      accountId: id,
      profileId: p.id,
      maturity: p.maturity,
      region: process.env.DEV_REGION ?? "IN",
      policyVersion: p.version,
    };
  });
  app.get("/internal/account", async (req) => {
    internal(req);
    const { id } = await account(req);
    return { accountId: id };
  });
} else {
  await collection("items").createIndex(
    { profileId: 1, titleId: 1 },
    { unique: true },
  );
  app.get("/watchlist", async (req) => {
    const c = await context(req),
      { limit, offset } = pagination(req.query);
    return {
      items: await collection("items")
        .find({ profileId: c.profileId })
        .sort({ titleId: 1 })
        .skip(offset)
        .limit(limit)
        .project({ _id: 0 })
        .toArray(),
    };
  });
  app.put("/watchlist/titles/:id", async (req, res) => {
    const c = await context(req),
      titleId = (req.params as any).id;
    let response: Response;
    try {
      response = await fetch(`${required("CATALOG_URL")}/internal/titles`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: String(req.headers.authorization),
          "x-profile-token": String(req.headers["x-profile-token"]),
          "x-service-key": key,
        },
        body: JSON.stringify({ ids: [titleId] }),
        signal: AbortSignal.timeout(800),
      });
    } catch {
      throw new Problem(503, "Catalog unavailable");
    }
    if (!response.ok) throw new Problem(503, "Catalog unavailable");
    const titles = (await response.json()) as { items: unknown[] };
    if (!titles.items.length)
      throw new Problem(404, "Eligible title not found");
    await collection("items").updateOne(
      { profileId: c.profileId, titleId },
      {
        $setOnInsert: {
          accountId: c.accountId,
          addedAt: new Date().toISOString(),
        },
      },
      { upsert: true },
    );
    return res.code(204).send();
  });
  app.delete("/watchlist/titles/:id", async (req, res) => {
    const c = await context(req);
    await collection("items").deleteOne({
      profileId: c.profileId,
      titleId: (req.params as any).id,
    });
    return res.code(204).send();
  });
  app.head("/watchlist/titles/:id", async (req, res) => {
    const c = await context(req);
    return res
      .code(
        (await collection("items").findOne({
          profileId: c.profileId,
          titleId: (req.params as any).id,
        }))
          ? 200
          : 404,
      )
      .send();
  });
  const consumer = kafka.consumer({ groupId: "watchlist-lifecycle-v1" });
  await consumer.connect();
  await consumer.subscribe({
    topic: "profile.lifecycle.v1",
    fromBeginning: true,
  });
  await consumer.run({
    eachMessage: async ({ message }) => {
      const e = JSON.parse(message.value!.toString());
      if (e.data.deleted) {
        await collection("items").deleteMany({
          profileId: { $in: e.data.profileIds },
        });
      }
    },
  });
  app.addHook("onClose", async () => consumer.disconnect());
}
app.addHook("onClose", async () => {
  clearInterval(relay);
  await producer.disconnect();
  await mongo.close();
});
process.on("SIGTERM", () => {
  void app.close();
});
process.on("SIGINT", () => {
  void app.close();
});
await app.listen({ port: Number(process.env.PORT ?? 8011), host: "0.0.0.0" });
