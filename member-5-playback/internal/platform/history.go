package platform

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gocql/gocql"
	"github.com/segmentio/kafka-go"
)

type History struct {
	DB    *gocql.Session
	Kafka *kafka.Writer
}

func NewHistory() *History {
	cluster := gocql.NewCluster(strings.Split(Env("CASSANDRA_HOSTS"), ",")...)
	cluster.Consistency = gocql.Quorum
	cluster.Timeout = 5 * time.Second
	cluster.ConnectTimeout = 10 * time.Second
	s, err := cluster.CreateSession()
	if err != nil {
		panic(err)
	}
	for _, statement := range []string{
		`CREATE KEYSPACE IF NOT EXISTS history WITH replication = {'class':'SimpleStrategy','replication_factor':1}`,
		`CREATE TABLE IF NOT EXISTS history.events(profile_id text,bucket text,ended_at timestamp,session_id text,title_id text,position bigint,duration bigint,PRIMARY KEY((profile_id,bucket),ended_at,session_id)) WITH CLUSTERING ORDER BY (ended_at DESC,session_id ASC)`,
		`CREATE TABLE IF NOT EXISTS history.progress(profile_id text,title_id text,ended_at timestamp,session_id text,position bigint,duration bigint,PRIMARY KEY(profile_id,title_id))`,
		`CREATE TABLE IF NOT EXISTS history.suppression(profile_id text,title_id text,cleared_at timestamp,deleted boolean,PRIMARY KEY(profile_id,title_id))`,
	} {
		if err = s.Query(statement).Exec(); err != nil {
			panic(err)
		}
	}
	return &History{s, Writer()}
}
func (h *History) suppressed(profile, title string, at time.Time) (bool, error) {
	for _, id := range []string{"*", title} {
		var cleared time.Time
		var deleted bool
		err := h.DB.Query("SELECT cleared_at,deleted FROM history.suppression WHERE profile_id=? AND title_id=?", profile, id).Scan(&cleared, &deleted)
		if err != nil && err != gocql.ErrNotFound {
			return true, err
		}
		if err == nil && (deleted || !at.After(cleared)) {
			return true, nil
		}
	}
	return false, nil
}
func (h *History) apply(ctx context.Context, e Event) error {
	var s Session
	if err := json.Unmarshal(e.Data, &s); err != nil {
		return err
	}
	at, err := time.Parse(time.RFC3339Nano, s.EndedAt)
	if err != nil {
		return err
	}
	suppressed, err := h.suppressed(s.ProfileID, s.TitleID, at)
	if err != nil {
		return err
	}
	ttl := RemainingTTL(at, time.Now())
	if suppressed || ttl == 0 {
		return nil
	}
	if err = h.DB.Query("INSERT INTO history.events(profile_id,bucket,ended_at,session_id,title_id,position,duration) VALUES (?,?,?,?,?,?,?) USING TTL ?", s.ProfileID, at.Format("2006-01"), at, s.ID, s.TitleID, s.Position, s.Duration, ttl).WithContext(ctx).Exec(); err != nil {
		return err
	}
	// Timestamped upserts are deterministic on replay; tie-break collisions are a production gate.
	if err = h.DB.Query("INSERT INTO history.progress(profile_id,title_id,ended_at,session_id,position,duration) VALUES (?,?,?,?,?,?) USING TIMESTAMP ? AND TTL ?", s.ProfileID, s.TitleID, at, s.ID, s.Position, s.Duration, at.UnixMicro(), ttl).WithContext(ctx).Exec(); err != nil {
		return err
	}
	return Publish(ctx, h.Kafka, "watch.history.recorded.v1", Envelope("watch-history", "WatchRecorded", "watch:"+s.ID, s.ProfileID, e.Version, at, s))
}
func (h *History) Run(ctx context.Context, topic string) {
	reader := kafka.NewReader(kafka.ReaderConfig{Brokers: strings.Split(Env("KAFKA_BROKERS"), ","), GroupID: "watch-history-" + topic, Topic: topic, StartOffset: kafka.FirstOffset, CommitInterval: 0})
	defer reader.Close()
	for {
		message, err := reader.FetchMessage(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			time.Sleep(time.Second)
			continue
		}
		for {
			var e Event
			err = json.Unmarshal(message.Value, &e)
			if err == nil {
				if topic == "profile.lifecycle.v1" {
					err = h.erase(e)
				} else {
					err = h.apply(ctx, e)
				}
			}
			if err == nil {
				err = reader.CommitMessages(ctx, message)
			}
			if err == nil {
				break
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Second):
			}
		}
	}
}
func (h *History) erase(e Event) error {
	var data struct {
		Deleted bool     `json:"deleted"`
		IDs     []string `json:"profileIds"`
	}
	if err := json.Unmarshal(e.Data, &data); err != nil {
		return err
	}
	if !data.Deleted {
		return nil
	}
	for _, id := range data.IDs {
		if err := h.DB.Query("INSERT INTO history.suppression(profile_id,title_id,cleared_at,deleted) VALUES (?,'*',?,true)", id, time.Now()).Exec(); err != nil {
			return err
		}
		if err := h.DB.Query("DELETE FROM history.progress WHERE profile_id=?", id).Exec(); err != nil {
			return err
		}
		for month := 0; month < 25; month++ {
			if err := h.DB.Query("DELETE FROM history.events WHERE profile_id=? AND bucket=?", id, time.Now().AddDate(0, -month, 0).Format("2006-01")).Exec(); err != nil {
				return err
			}
		}
	}
	return nil
}
func (h *History) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /health/ready", Route(func(w http.ResponseWriter, r *http.Request) error {
		var name string
		if err := h.DB.Query("SELECT cluster_name FROM system.local").Scan(&name); err != nil {
			return err
		}
		JSON(w, 200, map[string]string{"status": "ok"})
		return nil
	}))
	mux.HandleFunc("GET /history", Route(h.list))
	mux.HandleFunc("GET /history/continue", Route(h.progress))
	mux.HandleFunc("DELETE /history", Route(func(w http.ResponseWriter, r *http.Request) error { return h.clear(w, r, "*") }))
	mux.HandleFunc("DELETE /history/titles/{id}", Route(func(w http.ResponseWriter, r *http.Request) error { return h.clear(w, r, r.PathValue("id")) }))
}
func (h *History) clear(w http.ResponseWriter, r *http.Request, title string) error {
	c, err := Context(r)
	if err != nil {
		return err
	}
	if err = h.DB.Query("INSERT INTO history.suppression(profile_id,title_id,cleared_at,deleted) VALUES (?,?,?,false)", c.ProfileID, title, time.Now()).Exec(); err != nil {
		return err
	}
	if title == "*" {
		err = h.DB.Query("DELETE FROM history.progress WHERE profile_id=?", c.ProfileID).Exec()
	} else {
		err = h.DB.Query("DELETE FROM history.progress WHERE profile_id=? AND title_id=?", c.ProfileID, title).Exec()
	}
	if err != nil {
		return err
	}
	w.WriteHeader(204)
	return nil
}
func (h *History) progress(w http.ResponseWriter, r *http.Request) error {
	c, err := Context(r)
	if err != nil {
		return err
	}
	iter := h.DB.Query("SELECT title_id,ended_at,session_id,position,duration FROM history.progress WHERE profile_id=? LIMIT 100", c.ProfileID).Iter()
	items := []map[string]any{}
	var title, id string
	var at time.Time
	var position, duration int64
	for iter.Scan(&title, &at, &id, &position, &duration) {
		hidden, err := h.suppressed(c.ProfileID, title, at)
		if err != nil {
			return err
		}
		if !hidden && position < duration {
			items = append(items, map[string]any{"titleId": title, "sessionId": id, "positionSeconds": position, "durationSeconds": duration, "endedAt": at})
		}
	}
	if err = iter.Close(); err != nil {
		return err
	}
	JSON(w, 200, map[string]any{"items": items})
	return nil
}
func (h *History) list(w http.ResponseWriter, r *http.Request) error {
	c, err := Context(r)
	if err != nil {
		return err
	}
	limit := 20
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil {
			return Problem{400, "Invalid limit"}
		}
	}
	if limit < 1 || limit > 100 {
		return Problem{400, "Invalid limit"}
	}
	bucket := r.URL.Query().Get("month")
	if bucket == "" {
		bucket = time.Now().Format("2006-01")
	}
	if _, err = time.Parse("2006-01", bucket); err != nil {
		return Problem{400, "Invalid month"}
	}
	iter := h.DB.Query("SELECT title_id,ended_at,session_id,position,duration FROM history.events WHERE profile_id=? AND bucket=? LIMIT ?", c.ProfileID, bucket, limit).Iter()
	items := []map[string]any{}
	var title, id string
	var at time.Time
	var position, duration int64
	for iter.Scan(&title, &at, &id, &position, &duration) {
		hidden, err := h.suppressed(c.ProfileID, title, at)
		if err != nil {
			return err
		}
		if !hidden {
			items = append(items, map[string]any{"titleId": title, "sessionId": id, "positionSeconds": position, "durationSeconds": duration, "endedAt": at})
		}
	}
	if err = iter.Close(); err != nil {
		return err
	}
	JSON(w, 200, map[string]any{"items": items, "month": bucket})
	return nil
}
