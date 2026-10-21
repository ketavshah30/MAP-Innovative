import hmac
import json
import logging
import os
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import httpx
import redis
import uvicorn
from confluent_kafka import Consumer
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from neo4j import GraphDatabase
from pydantic import BaseModel, ConfigDict

from .ranking import rank

SERVICE = os.environ.get("SERVICE_NAME", "reco-api")
SERVICE_KEY = os.environ["SERVICE_KEY"]
PROFILE_URL = os.environ["PROFILE_URL"]
CATALOG_URL = os.environ["CATALOG_URL"]
driver = GraphDatabase.driver(os.environ["NEO4J_URL"], auth=("neo4j", os.environ["NEO4J_PASSWORD"]))
cache = redis.Redis.from_url(os.environ["REDIS_URL"], decode_responses=True, socket_timeout=0.5)
stop = threading.Event()


def apply_event(tx, event, topic):
    # Marker and effects share a graph transaction. Replays cannot increment counts twice.
    if tx.run("MATCH (e:Consumed {id:$id}) RETURN e", id=event["id"]).single():
        return
    data = event["data"]
    if topic == "catalog.title.v1":
        old = tx.run("MATCH (t:Title {id:$id}) RETURN t.version AS version", id=data["id"]).single()
        if not old or (old["version"] or 0) < event["version"]:
            tx.run("MERGE (t:Title {id:$id}) SET t += $properties", id=data["id"], properties={k: v for k, v in data.items() if v is not None}).consume()
    elif topic == "profile.lifecycle.v1" and data.get("deleted"):
        for profile_id in data["profileIds"]:
            tx.run("MERGE (p:Profile {id:$id}) SET p.deleted=true", id=profile_id).consume()
            tx.run("MATCH (:Profile {id:$id})-[w:WATCHED]->() DELETE w", id=profile_id).consume()
    elif topic == "watch.history.recorded.v1":
        profile_id = data["profileId"]
        p = tx.run("MATCH (p:Profile {id:$id}) RETURN p.deleted AS deleted", id=profile_id).single()
        if not p or not p["deleted"]:
            tx.run("MERGE (p:Profile {id:$profile}) ON CREATE SET p.deleted=false MERGE (t:Title {id:$title}) MERGE (p)-[w:WATCHED]->(t) SET w.count=coalesce(w.count,0)+1, t.watches=coalesce(t.watches,0)+1", profile=profile_id, title=data["titleId"]).consume()
    tx.run("CREATE (:Consumed {id:$id})", id=event["id"]).consume()


def ingest():
    consumer = Consumer({"bootstrap.servers": os.environ["KAFKA_BROKERS"], "group.id": "reco-engine-v1", "auto.offset.reset": "earliest", "enable.auto.commit": False, "isolation.level": "read_committed"})
    consumer.subscribe(["catalog.title.v1", "watch.history.recorded.v1", "profile.lifecycle.v1"])
    try:
        while not stop.is_set():
            message = consumer.poll(0.5)
            if not message or message.error():
                continue
            # Retry the current message in place; never commit a later offset past a failed event.
            while not stop.is_set():
                try:
                    with driver.session() as session:
                        session.execute_write(apply_event, json.loads(message.value()), message.topic())
                    consumer.commit(message=message, asynchronous=False)
                    break
                except Exception:
                    logging.exception("Recommendation ingestion paused at failed event")
                    stop.wait(2)
    finally:
        consumer.close()


@asynccontextmanager
async def lifespan(_app):
    worker = None
    if SERVICE == "reco-engine":
        with driver.session() as session:
            for label in ["Title", "Profile", "Consumed", "Job"]:
                session.run(f"CREATE CONSTRAINT IF NOT EXISTS FOR (n:{label}) REQUIRE n.id IS UNIQUE").consume()
        worker = threading.Thread(target=ingest, daemon=True)
        worker.start()
    yield
    stop.set()
    if worker:
        worker.join(timeout=8)
    driver.close()
    cache.close()


app = FastAPI(title=SERVICE, lifespan=lifespan, docs_url=None, redoc_url=None)


@app.exception_handler(HTTPException)
async def problem(_request, error):
    return JSONResponse({"type": "about:blank", "title": str(error.detail), "status": error.status_code}, status_code=error.status_code, media_type="application/problem+json")


@app.get("/health/live")
def live():
    return {"status": "ok", "service": SERVICE}


@app.get("/health/ready")
def ready():
    driver.verify_connectivity()
    return live()


def headers(request):
    return {"authorization": request.headers.get("authorization", ""), "x-profile-token": request.headers.get("x-profile-token", ""), "x-service-key": SERVICE_KEY}


def context(request):
    try:
        response = httpx.get(f"{PROFILE_URL}/internal/context", headers=headers(request), timeout=0.8)
    except httpx.HTTPError:
        raise HTTPException(503, "Profile authority unavailable")
    if response.status_code != 200:
        raise HTTPException(response.status_code if response.status_code in (401, 403) else 503, "Invalid profile context")
    return response.json()


def graph_candidates(profile_id):
    with driver.session(default_access_mode="READ") as session:
        candidates = [dict(r["t"]) for r in session.run("MATCH (t:Title) WHERE t.published=true AND coalesce(t.deleted,false)=false RETURN t ORDER BY coalesce(t.watches,0) DESC,t.id LIMIT 1000")]
        watched = [dict(r["t"]) for r in session.run("MATCH (:Profile {id:$id})-[:WATCHED]->(t:Title) RETURN t LIMIT 1000", id=profile_id)]
    return candidates, watched


if SERVICE == "reco-api":
    @app.get("/recommendations/{kind}")
    def recommendations(kind: str, request: Request, titleId: str | None = None, limit: int = 20):
        if kind not in ("home", "similar", "trending") or not 1 <= limit <= 100:
            raise HTTPException(400, "Invalid recommendation request")
        ctx = context(request)
        degraded = False
        source = "graph"
        generated = datetime.now(timezone.utc).isoformat()
        try:
            candidates, watched = graph_candidates(ctx["profileId"])
            if kind == "similar":
                if not titleId:
                    raise HTTPException(400, "titleId required")
                watched = [t for t in candidates if t["id"] == titleId]
            ids = rank(candidates, watched if kind != "trending" else [], 100)
        except HTTPException:
            raise
        except Exception:
            degraded, source, ids = True, "empty", []
            try:
                snapshot = json.loads(cache.get(f"trending:{ctx['region']}") or "null")
                if snapshot and time.time() - snapshot["createdEpoch"] <= 300:
                    ids, generated, source = snapshot["ids"], snapshot["generatedAt"], "cache"
            except Exception:
                pass
        try:
            response = httpx.post(f"{CATALOG_URL}/internal/titles", json={"ids": ids[:100]}, headers=headers(request), timeout=0.8)
            response.raise_for_status()
            eligible = {item["id"]: item for item in response.json()["items"]}
            items = [eligible[i] for i in ids if i in eligible][:limit]
        except Exception:
            items, source, degraded = [], "empty", True
        return {"items": items, "source": source, "degraded": degraded, "generatedAt": generated}
else:
    class JobInput(BaseModel):
        model_config = ConfigDict(extra="forbid")
        region: str = "IN"

    def workload(request):
        if not hmac.compare_digest(request.headers.get("x-service-key", ""), SERVICE_KEY):
            raise HTTPException(403, "Workload identity required")

    @app.post("/internal/jobs", status_code=201)
    def recompute(body: JobInput, request: Request):
        workload(request)
        job_id = str(uuid.uuid4())
        with driver.session() as session:
            session.run("CREATE (:Job {id:$id,status:'RUNNING'})", id=job_id).consume()
        try:
            candidates, _ = graph_candidates("")
            result = {"ids": rank(candidates, [], 100), "generatedAt": datetime.now(timezone.utc).isoformat(), "createdEpoch": time.time()}
            # Persist authoritative result before publishing the cache.
            with driver.session() as session:
                session.run("MATCH (j:Job {id:$id}) SET j.status='COMPLETE',j.result=$result", id=job_id, result=json.dumps(result)).consume()
            cache.set(f"trending:{body.region}", json.dumps(result), ex=300)
        except Exception:
            with driver.session() as session:
                session.run("MATCH (j:Job {id:$id}) SET j.status='FAILED'", id=job_id).consume()
            raise HTTPException(503, "Recompute failed; job retained")
        return {"id": job_id, "status": "COMPLETE"}

    @app.get("/internal/jobs/{job_id}")
    def job(job_id: str, request: Request):
        workload(request)
        with driver.session(default_access_mode="READ") as session:
            row = session.run("MATCH (j:Job {id:$id}) RETURN j", id=job_id).single()
        if not row:
            raise HTTPException(404, "Job not found")
        return dict(row["j"])


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8014")))
