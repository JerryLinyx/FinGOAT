package utils

import (
	"errors"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

type AuthIdentity struct {
	UserID   uint
	Username string
}

// jwtSecret returns the JWT signing secret from the JWT_SECRET environment
// variable. Falls back to an insecure dev value and logs a warning if unset.
func jwtSecret() []byte {
	s := os.Getenv("JWT_SECRET")
	if s == "" {
		log.Println("[WARN] JWT_SECRET env var is not set; using insecure development fallback")
		s = "JWT_SECRET_DEV_INSECURE"
	}
	return []byte(s)
}

func HashPassword(password string) (string, error) {
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hashedPassword), nil
}

func GenerateJWT(userID uint, username string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"uid":      userID,
		"username": username,
		"exp":      time.Now().Add(time.Hour * 24).Unix(),
	})
	tokenString, err := token.SignedString(jwtSecret())
	if err != nil {
		return "", err
	}
	return "Bearer " + tokenString, nil
}

func CheckPassword(password string, hashedPassword string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(password))
	return err == nil
}

func ParseJWT(tokenString string) (AuthIdentity, error) {
	if len(tokenString) > 7 && tokenString[:7] == "Bearer " {
		tokenString = tokenString[7:]
	}

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return jwtSecret(), nil
	})

	if err != nil {
		return AuthIdentity{}, err
	}
	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
		identity := AuthIdentity{}
		if username, ok := claims["username"].(string); ok {
			identity.Username = username
		}
		if rawUserID, exists := claims["uid"]; exists {
			userID, err := parseUintClaim(rawUserID)
			if err != nil {
				return AuthIdentity{}, err
			}
			identity.UserID = userID
		}
		if identity.UserID == 0 && identity.Username == "" {
			return AuthIdentity{}, errors.New("token missing both uid and username claims")
		}
		return identity, nil
	}
	return AuthIdentity{}, errors.New("invalid token claims")
}

func parseUintClaim(raw interface{}) (uint, error) {
	switch v := raw.(type) {
	case float64:
		if v < 0 {
			return 0, errors.New("uid claim must be non-negative")
		}
		return uint(v), nil
	case int:
		if v < 0 {
			return 0, errors.New("uid claim must be non-negative")
		}
		return uint(v), nil
	case int64:
		if v < 0 {
			return 0, errors.New("uid claim must be non-negative")
		}
		return uint(v), nil
	case uint:
		return v, nil
	case uint64:
		return uint(v), nil
	case string:
		parsed, err := strconv.ParseUint(v, 10, 64)
		if err != nil {
			return 0, errors.New("uid claim is not a valid unsigned integer")
		}
		return uint(parsed), nil
	default:
		return 0, errors.New("uid claim has unsupported type")
	}
}
