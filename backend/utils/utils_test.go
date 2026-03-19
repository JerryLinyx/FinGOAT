package utils

import (
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

func TestGenerateAndParseJWTWithUID(t *testing.T) {
	token, err := GenerateJWT(42, "alice")
	if err != nil {
		t.Fatalf("GenerateJWT() error = %v", err)
	}

	identity, err := ParseJWT(token)
	if err != nil {
		t.Fatalf("ParseJWT() error = %v", err)
	}
	if identity.UserID != 42 {
		t.Fatalf("expected uid 42, got %d", identity.UserID)
	}
	if identity.Username != "alice" {
		t.Fatalf("expected username alice, got %q", identity.Username)
	}
}

func TestParseJWTSupportsLegacyUsernameOnlyClaim(t *testing.T) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"username": "legacy-user",
		"exp":      farFutureUnix(),
	})
	signed, err := token.SignedString(jwtSecret())
	if err != nil {
		t.Fatalf("SignedString() error = %v", err)
	}

	identity, err := ParseJWT("Bearer " + signed)
	if err != nil {
		t.Fatalf("ParseJWT() error = %v", err)
	}
	if identity.UserID != 0 {
		t.Fatalf("expected legacy token uid 0, got %d", identity.UserID)
	}
	if identity.Username != "legacy-user" {
		t.Fatalf("expected legacy username, got %q", identity.Username)
	}
}

func TestParseJWTRejectsTokenWithoutIdentityClaims(t *testing.T) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"exp": farFutureUnix(),
	})
	signed, err := token.SignedString(jwtSecret())
	if err != nil {
		t.Fatalf("SignedString() error = %v", err)
	}

	if _, err := ParseJWT(signed); err == nil {
		t.Fatalf("expected ParseJWT() to reject token without uid/username")
	}
}

func farFutureUnix() int64 {
	return 4102444800
}
