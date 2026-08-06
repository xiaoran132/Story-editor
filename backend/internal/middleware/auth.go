package middleware

import (
	"strings"

	"backend/internal/authz"
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

// RequirePermission 必须在 AuthRequired 之后挂载：按 token 里的角色快照做 RBAC 判定，
// 角色不具备该权限则 403。权限→角色映射的唯一事实来源是 internal/authz。
// 提权（手动改库 UPDATE users SET role='admin'）后，用户需重新登录才能拿到带新角色的 token。
func RequirePermission(perm authz.Permission) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !authz.Can(GetRole(c), perm) {
			pkg.Error(c, pkg.Forbidden("permission denied"))
			c.Abort()
			return
		}
		c.Next()
	}
}

// RequireAdmin 保留为便捷别名（向后兼容），委托到 RequirePermission。
func RequireAdmin() gin.HandlerFunc {
	return RequirePermission(authz.PermPlatformLLMManage)
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
