package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
)

type Session struct {
	ID           string `json:"sessionId"`
	AccountID    string `json:"accountId"`
	ProfileID    string `json:"profileId"`
	TitleID      string `json:"titleId"`
	AssetPath    string `json:"assetPath"`
	Duration     int64  `json:"durationSeconds"`
	Position     int64  `json:"positionSeconds"`
	Sequence     int64  `json:"sequence"`
	Status       string `json:"status"`
	ExpiresAt    int64  `json:"expiresAt"`
	AllowedUntil string `json:"allowedUntil"`
	EndedAt      string `json:"endedAt,omitempty"`
}
type Playback struct {
	Redis *redis.Client
	Kafka *kafka.Writer
}

func NewPlayback() *Playback {
	opts, err := redis.ParseURL(Env("REDIS_URL"))
	if err != nil {
		panic(err)
	}
	return &Playback{redis.NewClient(opts), Writer()}
}
func stateKey(account, id string) string { return "sess:{" + account + "}:" + id }
func accountKey(account string) string   { return "active:{" + account + "}" }

const reserveScript = `local current=redis.call('GET',KEYS[1]); if current then return current end; if redis.call('SCARD',KEYS[2])>=tonumber(ARGV[2]) then return 'LIMIT' end; redis.call('SET',KEYS[1],ARGV[1]);redis.call('SADD',KEYS[2],ARGV[3]);return ARGV[1]`
const updateScript = `local raw=redis.call('GET',KEYS[1]);if not raw then return 'MISSING' end;local s=cjson.decode(raw);if s.status=='ENDED' or s.status=='FINALIZING' then return 'ENDED' end;if tonumber(ARGV[1])<=s.sequence then return 'OLD' end;s.sequence=tonumber(ARGV[1]);s.positionSeconds=tonumber(ARGV[2]);s.expiresAt=tonumber(ARGV[3]);redis.call('SET',KEYS[1],cjson.encode(s));return cjson.encode(s)`
const finishScript = `local raw=redis.call('GET',KEYS[1]);if not raw then return 'MISSING' end;local s=cjson.decode(raw);if s.status=='ENDED' or s.status=='FINALIZING' then return raw end;s.status='FINALIZING';s.endedAt=ARGV[1];redis.call('SET',KEYS[1],cjson.encode(s));return cjson.encode(s)`
const commitFinishScript = `local raw=redis.call('GET',KEYS[1]);if not raw then return 0 end;local s=cjson.decode(raw);s.status='ENDED';redis.call('SET',KEYS[1],cjson.encode(s),'EX',604800);redis.call('SREM',KEYS[2],ARGV[1]);return 1`

func (p *Playback) load(ctx context.Context, account, id string) (Session, error) {
	var s Session
	raw, err := p.Redis.Get(ctx, stateKey(account, id)).Bytes()
	if err == redis.Nil {
		return s, Problem{404, "Session not found"}
	}
	if err != nil {
		return s, err
	}
	err = json.Unmarshal(raw, &s)
	return s, err
}
func (p *Playback) owned(r *http.Request) (Profile, Session, error) {
	c, err := Context(r)
	if err != nil {
		return c, Session{}, err
	}
	s, err := p.load(r.Context(), c.AccountID, r.PathValue("id"))
	if err != nil {
		return c, s, err
	}
	if s.ProfileID != c.ProfileID {
		return c, s, Problem{404, "Session not found"}
	}
	return c, s, nil
}
func (p *Playback) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /health/ready", Route(func(w http.ResponseWriter, r *http.Request) error {
		if err := p.Redis.Ping(r.Context()).Err(); err != nil {
			return err
		}
		JSON(w, 200, map[string]string{"status": "ok"})
		return nil
	}))
	mux.HandleFunc("POST /sessions", Route(p.start))
	mux.HandleFunc("GET /sessions", Route(func(w http.ResponseWriter, r *http.Request) error {
		c, err := Context(r)
		if err != nil {
			return err
		}
		ids, err := p.Redis.SMembers(r.Context(), accountKey(c.AccountID)).Result()
		if err != nil {
			return err
		}
		items := []Session{}
		for _, id := range ids {
			s, err := p.load(r.Context(), c.AccountID, id)
			if err == nil && s.ProfileID == c.ProfileID {
				items = append(items, s)
			}
		}
		JSON(w, 200, map[string]any{"items": items})
		return nil
	}))
	mux.HandleFunc("POST /sessions/{id}/heartbeat", Route(p.heartbeat))
	mux.HandleFunc("POST /sessions/{id}/stop", Route(func(w http.ResponseWriter, r *http.Request) error {
		_, s, err := p.owned(r)
		if err != nil {
			return err
		}
		if err = p.finalize(r.Context(), s); err != nil {
			return err
		}
		JSON(w, 200, map[string]string{"sessionId": s.ID, "status": "ENDED"})
		return nil
	}))
	mux.HandleFunc("POST /sessions/{id}/refresh", Route(func(w http.ResponseWriter, r *http.Request) error {
		_, s, err := p.owned(r)
		if err != nil {
			return err
		}
		if s.Status != "ACTIVE" || s.ExpiresAt <= time.Now().Unix() {
			return Problem{409, "Session not active"}
		}
		var rights struct {
			AllowedUntil string `json:"allowedUntil"`
		}
		if err = Call(r, "POST", Env("CATALOG_WRITE_URL")+"/internal/authorize", map[string]string{"titleId": s.TitleID}, &rights); err != nil {
			return err
		}
		var ent struct {
			Active     bool   `json:"active"`
			ValidUntil string `json:"validUntil"`
		}
		if err = Call(r, "GET", Env("SUBSCRIPTION_URL")+"/internal/entitlement", nil, &ent); err != nil {
			return err
		}
		if !ent.Active {
			return Problem{403, "No active entitlement"}
		}
		s.AllowedUntil = minDate(rights.AllowedUntil, ent.ValidUntil)
		JSON(w, 200, p.response(s))
		return nil
	}))
	mux.HandleFunc("GET /media/", Route(p.media))
}
func minDate(a, b string) string {
	ta, _ := time.Parse(time.RFC3339, a)
	tb, _ := time.Parse(time.RFC3339, b)
	if ta.Before(tb) {
		return a
	}
	return b
}
func (p *Playback) response(s Session) map[string]any {
	until, _ := time.Parse(time.RFC3339, s.AllowedUntil)
	expiry := time.Now().Add(300 * time.Second).Unix()
	if until.Unix() < expiry {
		expiry = until.Unix()
	}
	path := "/media/" + s.AssetPath
	return map[string]any{"session": s, "url": Env("PUBLIC_API_URL") + path + "?expires=" + strconv.FormatInt(expiry, 10) + "&signature=" + Signature(path, expiry, Env("MEDIA_KEY"))}
}
func (p *Playback) start(w http.ResponseWriter, r *http.Request) error {
	c, err := Context(r)
	if err != nil {
		return err
	}
	var input struct {
		TitleID string `json:"titleId"`
	}
	if err = Decode(r, &input); err != nil {
		return err
	}
	if input.TitleID == "" {
		return Problem{400, "titleId required"}
	}
	key := r.Header.Get("Idempotency-Key")
	if len(key) < 1 || len(key) > 128 {
		return Problem{400, "Idempotency-Key required"}
	}
	var ent struct {
		Active     bool   `json:"active"`
		MaxStreams int    `json:"maxStreams"`
		ValidUntil string `json:"validUntil"`
	}
	if err = Call(r, "GET", Env("SUBSCRIPTION_URL")+"/internal/entitlement", nil, &ent); err != nil {
		return err
	}
	if !ent.Active {
		return Problem{403, "Active subscription required"}
	}
	var rights struct {
		AssetPath    string `json:"assetPath"`
		Duration     int64  `json:"durationSeconds"`
		AllowedUntil string `json:"allowedUntil"`
	}
	if err = Call(r, "POST", Env("CATALOG_WRITE_URL")+"/internal/authorize", input, &rights); err != nil {
		return err
	}
	id := StableID(c.AccountID, key)
	s := Session{ID: id, AccountID: c.AccountID, ProfileID: c.ProfileID, TitleID: input.TitleID, AssetPath: rights.AssetPath, Duration: rights.Duration, Status: "PROVISIONAL", ExpiresAt: time.Now().Add(90 * time.Second).Unix(), AllowedUntil: minDate(rights.AllowedUntil, ent.ValidUntil)}
	raw, _ := json.Marshal(s)
	result, err := p.Redis.Eval(r.Context(), reserveScript, []string{stateKey(c.AccountID, id), accountKey(c.AccountID)}, string(raw), ent.MaxStreams, id).Text()
	if err != nil {
		return err
	}
	if result == "LIMIT" {
		return Problem{409, "Concurrent stream limit reached"}
	}
	if err = json.Unmarshal([]byte(result), &s); err != nil {
		return err
	}
	if s.TitleID != input.TitleID || s.ProfileID != c.ProfileID {
		return Problem{409, "Idempotency key reused with different request"}
	}
	if s.Status == "ENDED" || s.Status == "FINALIZING" {
		return Problem{409, "Session ended; use a new idempotency key"}
	}
	if s.Status == "PROVISIONAL" {
		if err = Publish(r.Context(), p.Kafka, "playback.session.lifecycle.v1", Envelope("playback-session", "SessionStarted", "start:"+id, id, 1, time.Now(), s)); err != nil {
			return err
		}
		s.Status = "ACTIVE"
		raw, _ = json.Marshal(s)
		if err = p.Redis.Set(r.Context(), stateKey(c.AccountID, id), raw, 0).Err(); err != nil {
			return err
		}
	}
	if err = p.Redis.ZAdd(r.Context(), "expiry", redis.Z{Score: float64(s.ExpiresAt), Member: stateKey(c.AccountID, id)}).Err(); err != nil {
		return err
	}
	JSON(w, 201, p.response(s))
	return nil
}
func (p *Playback) heartbeat(w http.ResponseWriter, r *http.Request) error {
	_, s, err := p.owned(r)
	if err != nil {
		return err
	}
	var input struct {
		Sequence int64 `json:"sequence"`
		Position int64 `json:"positionSeconds"`
	}
	if err = Decode(r, &input); err != nil {
		return err
	}
	if input.Sequence <= 0 || input.Position < 0 || input.Position > s.Duration {
		return Problem{400, "Invalid sequence or position"}
	}
	if s.Status != "ACTIVE" || s.ExpiresAt <= time.Now().Unix() {
		return Problem{409, "Session is no longer active"}
	}
	if input.Sequence <= s.Sequence {
		return Problem{409, "Stale heartbeat"}
	}
	// Journal acknowledgement precedes the successful HTTP response. Local state updates remain a development adapter.
	next := s
	next.Sequence = input.Sequence
	next.Position = input.Position
	next.ExpiresAt = time.Now().Add(90 * time.Second).Unix()
	if err = Publish(r.Context(), p.Kafka, "playback.session.lifecycle.v1", Envelope("playback-session", "SessionCheckpoint", fmt.Sprintf("checkpoint:%s:%d", s.ID, input.Sequence), s.ID, input.Sequence+1, time.Now(), next)); err != nil {
		return err
	}
	result, err := p.Redis.Eval(r.Context(), updateScript, []string{stateKey(s.AccountID, s.ID)}, input.Sequence, input.Position, next.ExpiresAt).Text()
	if err != nil {
		return err
	}
	if result == "OLD" || result == "ENDED" || result == "MISSING" {
		return Problem{409, "Concurrent session transition"}
	}
	if err = p.Redis.ZAdd(r.Context(), "expiry", redis.Z{Score: float64(next.ExpiresAt), Member: stateKey(s.AccountID, s.ID)}).Err(); err != nil {
		return err
	}
	JSON(w, 200, next)
	return nil
}
func (p *Playback) finalize(ctx context.Context, s Session) error {
	raw, err := p.Redis.Eval(ctx, finishScript, []string{stateKey(s.AccountID, s.ID)}, time.Now().UTC().Format(time.RFC3339Nano)).Text()
	if err != nil {
		return err
	}
	if raw == "MISSING" {
		return nil
	}
	if err = json.Unmarshal([]byte(raw), &s); err != nil {
		return err
	}
	if s.Status == "ENDED" {
		return nil
	}
	at, err := time.Parse(time.RFC3339Nano, s.EndedAt)
	if err != nil {
		return err
	}
	if err = Publish(ctx, p.Kafka, "playback.session.ended.v1", Envelope("playback-session", "SessionEnded", "end:"+s.ID, s.ProfileID, s.Sequence+2, at, s)); err != nil {
		return err
	}
	if err = p.Redis.Eval(ctx, commitFinishScript, []string{stateKey(s.AccountID, s.ID), accountKey(s.AccountID)}, s.ID).Err(); err != nil {
		return err
	}
	return p.Redis.ZRem(ctx, "expiry", stateKey(s.AccountID, s.ID)).Err()
}
func (p *Playback) Run(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// SCAN also recovers sessions whose expiry-index write was interrupted.
			var cursor uint64
			for {
				keys, next, err := p.Redis.Scan(ctx, cursor, "sess:*", 100).Result()
				if err != nil {
					break
				}
				for _, key := range keys {
					raw, err := p.Redis.Get(ctx, key).Bytes()
					if err != nil {
						continue
					}
					var s Session
					if json.Unmarshal(raw, &s) == nil && (s.Status == "FINALIZING" || (s.Status != "ENDED" && s.ExpiresAt <= time.Now().Unix())) {
						_ = p.finalize(ctx, s)
					}
				}
				cursor = next
				if cursor == 0 {
					break
				}
			}
		}
	}
}
func (p *Playback) media(w http.ResponseWriter, r *http.Request) error {
	expiry, err := strconv.ParseInt(r.URL.Query().Get("expires"), 10, 64)
	if err != nil || !ValidSignature(r.URL.Path, expiry, r.URL.Query().Get("signature"), Env("MEDIA_KEY"), time.Now()) {
		return Problem{403, "Invalid or expired media signature"}
	}
	root, err := filepath.EvalSymlinks(Env("MEDIA_ROOT"))
	if err != nil {
		return Problem{404, "Install sample media first"}
	}
	root, _ = filepath.Abs(root)
	relative := strings.TrimPrefix(r.URL.Path, "/media/")
	target, err := filepath.EvalSymlinks(filepath.Join(root, filepath.FromSlash(relative)))
	if err != nil {
		return Problem{404, "Media not found"}
	}
	target, _ = filepath.Abs(target)
	rel, err := filepath.Rel(root, target)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return Problem{403, "Invalid media path"}
	}
	f, err := os.Open(target)
	if err != nil {
		return Problem{404, "Media not found"}
	}
	defer f.Close()
	if strings.HasSuffix(target, ".m3u8") {
		raw, err := io.ReadAll(io.LimitReader(f, 1048576))
		if err != nil {
			return err
		}
		lines := strings.Split(string(raw), "\n")
		for i, line := range lines {
			line = strings.TrimSpace(line)
			if line != "" && !strings.HasPrefix(line, "#") {
				u, err := url.Parse(line)
				if err != nil || u.IsAbs() || u.Host != "" || strings.Contains(line, "..") {
					return Problem{500, "Unsupported manifest URI"}
				}
				path := "/media/" + strings.TrimSuffix(relative, filepath.Base(relative)) + line
				lines[i] = path + "?expires=" + strconv.FormatInt(expiry, 10) + "&signature=" + Signature(path, expiry, Env("MEDIA_KEY"))
			}
		}
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
		w.Header().Set("Cache-Control", "private, no-store")
		_, err = w.Write([]byte(strings.Join(lines, "\n")))
		return err
	}
	w.Header().Set("Content-Type", "video/mp2t")
	w.Header().Set("Cache-Control", "private, no-store")
	_, err = io.Copy(w, f)
	return err
}
