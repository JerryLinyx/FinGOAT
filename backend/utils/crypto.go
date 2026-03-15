package utils

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"os"
)

// encryptionKeyCache caches the parsed key so we only decode it once.
var encryptionKeyCache []byte

// getEncryptionKey reads BYOK_ENCRYPTION_KEY from the environment and validates it.
// The env var must be a standard base64-encoded 32-byte value (AES-256).
func getEncryptionKey() ([]byte, error) {
	if encryptionKeyCache != nil {
		return encryptionKeyCache, nil
	}
	keyB64 := os.Getenv("BYOK_ENCRYPTION_KEY")
	if keyB64 == "" {
		return nil, errors.New("BYOK_ENCRYPTION_KEY is not set; cannot encrypt API keys")
	}
	key, err := base64.StdEncoding.DecodeString(keyB64)
	if err != nil {
		return nil, errors.New("BYOK_ENCRYPTION_KEY is not valid base64")
	}
	if len(key) != 32 {
		return nil, errors.New("BYOK_ENCRYPTION_KEY must decode to exactly 32 bytes for AES-256")
	}
	encryptionKeyCache = key
	return key, nil
}

// EncryptAPIKey encrypts plaintext using AES-256-GCM and returns a base64-encoded
// string of the form: base64(nonce || ciphertext).
func EncryptAPIKey(plaintext string) (string, error) {
	key, err := getEncryptionKey()
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	// Seal appends the ciphertext (and GCM tag) to nonce.
	sealed := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// DecryptAPIKey decodes and decrypts a value produced by EncryptAPIKey.
func DecryptAPIKey(encoded string) (string, error) {
	key, err := getEncryptionKey()
	if err != nil {
		return "", err
	}

	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", errors.New("invalid encrypted key format")
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", errors.New("encrypted key too short")
	}

	nonce, ciphertext := data[:nonceSize], data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", errors.New("decryption failed: invalid key or corrupted data")
	}

	return string(plaintext), nil
}

// MaskAPIKey returns a display-safe hint for an API key.
// Shows the first 8 characters followed by "****".
// If the key is 8 characters or shorter, returns "****".
func MaskAPIKey(key string) string {
	if len(key) <= 8 {
		return "****"
	}
	return key[:8] + "****"
}
