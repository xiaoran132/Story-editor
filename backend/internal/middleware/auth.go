package middleware

import (
	"strings"

	"backend/pkg"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func AuthRequired(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			pkg.Error(c, pkg.Unauthorized("missing authorization header"))
			c.Abort()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
			pkg.Error(c, pkg.Unauthorized("invalid authorization format"))
			c.Abort()
			return
		}

		claims, err := pkg.ParseToken(parts[1], secret)
		if err != nil {
			pkg.Error(c, pkg.Unauthorized("invalid or expired token"))
			c.Abort()
			return
		}

		c.Set("user_id", claims.UserID)
		c.Set("role", claims.Role)
		c.Next()
	}
}

// AuthOptional 尽力解析 Bearer token：有效则设 user_id/role，缺失/无效也放行（不 401）。
// 用于匿名可玩、但登录用户需归属的路由（如 /play/*）。
func AuthOptional(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) == 2 && strings.ToLower(parts[0]) == "bearer" {
				if claims, err := pkg.ParseToken(parts[1], secret); err == nil {
					c.Set("user_id", claims.UserID)
					c.Set("role", claims.Role)
				}
			}
		}
		c.Next()
	}
}

// RequireAdmin 必须在 AuthRequired 之后挂载：校验 token 里的角色快照为 admin，否则 403。
// 提权（手动改库 UPDATE users SET role='admin'）后，用户需重新登录才能拿到 admin token。
func RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		if GetRole(c) != "admin" {
			pkg.Error(c, pkg.Forbidden("admin privilege required"))
			c.Abort()
			return
		}
		c.Next()
	}
}

func GetUserID(c *gin.Context) uuid.UUID {
	id, exists := c.Get("user_id")
	if !exists {
		return uuid.Nil
	}
	uid, ok := id.(uuid.UUID)
	if !ok {
		return uuid.Nil
	}
	return uid
}

// GetRole 返回当前请求的角色快照（来自 JWT）；无则空串。
func GetRole(c *gin.Context) string {
	if v, ok := c.Get("role"); ok {
		if r, ok := v.(string); ok {
			return r
		}
	}
	return ""
}
