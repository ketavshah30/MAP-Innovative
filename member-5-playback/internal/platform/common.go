package platform

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/segmentio/kafka-go"
)

type Profile struct {
	AccountID string `json:"accountId"`
	ProfileID string `json:"profileId"`
	Maturity  int    `json:"maturity"`
	Region    string `json:"region"`
}
type Event struct {
	Specversion string          `json:"specversion"`
	ID          string          `json:"id"`
	Source      string          `json:"source"`
	Type        string          `json:"type"`
	Subject     string          `json:"subject"`
	Time        string          `json:"time"`
	Version     int64           `json:"version"`
	Data        json.RawMessage `json:"data"`
}
type Problem struct {
	Status  int
	Message string
}

func (p Problem) Error() string { return p.Message }
func Env(name string) string {
	v := os.Getenv(name)
	if v == "" {
		panic("Missing " + name)
	}
	return v
}
func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func Decode(r *http.Request, v any) error {
	d := json.NewDecoder(io.LimitReader(r.Body, 65537))
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return Problem{400, "Invalid JSON body"}
	}
	if d.Decode(new(any)) != io.EOF {
		return Problem{400, "Expected one JSON object"}
	}
	return nil
}
func Route(fn func(http.ResponseWriter, *http.Request) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := fn(w, r); err != nil {
			var p Problem
			if !errors.As(err, &p) {
				p = Problem{503, "Dependency unavailable"}
			}
			JSON(w, p.Status, map[string]any{"type": "about:blank", "title": p.Message, "status": p.Status})
		}
	}
}
func Call(r *http.Request, method, url string, input any, output any) error {
	var body io.Reader
	if input != nil {
		raw, _ := json.Marshal(input)
		body = bytes.NewReader(raw)
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", r.Header.Get("Authorization"))
	req.Header.Set("X-Profile-Token", r.Header.Get("X-Profile-Token"))
	req.Header.Set("X-Service-Key", Env("SERVICE_KEY"))
	req.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		status := response.StatusCode
		if status != 401 && status != 403 && status != 404 {
			status = 503
		}
		return Problem{status, "Authority rejected request"}
	}
	return json.NewDecoder(io.LimitReader(response.Body, 1048576)).Decode(output)
}
func Context(r *http.Request) (Profile, error) {
	var p Profile
	err := Call(r, "GET", Env("PROFILE_URL")+"/internal/context", nil, &p)
	return p, err
}
func Writer() *kafka.Writer {
	return &kafka.Writer{Addr: kafka.TCP(strings.Split(Env("KAFKA_BROKERS"), ",")...), Balancer: &kafka.Hash{}, RequiredAcks: kafka.RequireAll, WriteTimeout: 5 * time.Second, ReadTimeout: 5 * time.Second, AllowAutoTopicCreation: false}
}
func Publish(ctx context.Context, w *kafka.Writer, topic string, e Event) error {
	raw, _ := json.Marshal(e)
	return w.WriteMessages(ctx, kafka.Message{Topic: topic, Key: []byte(e.Subject), Value: raw})
}
func Envelope(source, kind, id, subject string, version int64, at time.Time, data any) Event {
	raw, _ := json.Marshal(data)
	return Event{"1.0", id, source, kind, subject, at.UTC().Format(time.RFC3339Nano), version, raw}
}
func StableID(parts ...string) string {
	h := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(h[:16])
}
func Signature(path string, expiry int64, key string) string {
	mac := hmac.New(sha256.New, []byte(key))
	fmt.Fprintf(mac, "%s\n%d", path, expiry)
	return hex.EncodeToString(mac.Sum(nil))
}
func ValidSignature(path string, expiry int64, signature, key string, now time.Time) bool {
	return expiry > now.Unix() && hmac.Equal([]byte(signature), []byte(Signature(path, expiry, key)))
}
func RemainingTTL(ended, timeNow time.Time) int {
	ttl := int(ended.Add(730 * 24 * time.Hour).Sub(timeNow).Seconds())
	if ttl < 0 {
		return 0
	}
	return ttl
}
