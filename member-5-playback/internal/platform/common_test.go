package platform

import (
	"testing"
	"time"
)

func TestSignatureBindsPathExpiryAndKey(t *testing.T) {
	now := time.Unix(100, 0)
	signature := Signature("/media/a/1.ts", 200, "key")
	if !ValidSignature("/media/a/1.ts", 200, signature, "key", now) {
		t.Fatal("valid signature rejected")
	}
	for _, path := range []string{"/media/b/1.ts", "/media/a/2.ts"} {
		if ValidSignature(path, 200, signature, "key", now) {
			t.Fatal("path substitution accepted")
		}
	}
	if ValidSignature("/media/a/1.ts", 100, signature, "key", now) {
		t.Fatal("expired signature accepted")
	}
	if ValidSignature("/media/a/1.ts", 200, signature, "wrong", now) {
		t.Fatal("wrong key accepted")
	}
}
func TestStableAdmissionIdentity(t *testing.T) {
	if StableID("a", "key") != StableID("a", "key") {
		t.Fatal("retry changed identity")
	}
	if StableID("a", "key") == StableID("b", "key") {
		t.Fatal("cross-account collision")
	}
}
func TestReplayDoesNotExtendRetention(t *testing.T) {
	end := time.Now().Add(-731 * 24 * time.Hour)
	if RemainingTTL(end, time.Now()) != 0 {
		t.Fatal("old event resurrected")
	}
	end = time.Now().Add(-24 * time.Hour)
	if RemainingTTL(end, time.Now()) >= 730*86400 {
		t.Fatal("retention reset")
	}
}
