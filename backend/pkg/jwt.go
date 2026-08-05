package pkg

import (
	"fmt"
	"time"

	jwtlib "github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type JWTClaims struct {
	UserID uuid.UUID `json:"user_id"`
	// Role 是签发时刻的角色快照（user/admin）。提权后需重新登录才能拿到带新 role 的 token。
	Role string `json:"role"`
	jwtlib.RegisteredClaims
}

func GenerateToken(userID uuid.UUID, role, secret string) (string, error) {
	claims := JWTClaims{
		UserID: userID,
		Role:   role,
		RegisteredClaims: jwtlib.RegisteredClaims{
			ExpiresAt: jwtlib.NewNumericDate(time.Now().Add(72 * time.Hour)),
			IssuedAt:  jwtlib.NewNumericDate(time.Now()),
		},
	}

	token := jwtlib.NewWithClaims(jwtlib.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func ParseToken(tokenStr string, secret string) (*JWTClaims, error) {
	token, err := jwtlib.ParseWithClaims(tokenStr, &JWTClaims{}, func(t *jwtlib.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwtlib.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*JWTClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	return claims, nil
}
