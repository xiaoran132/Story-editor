// Package authz 是轻量 RBAC 的单一事实来源：以纯常量声明角色→权限映射，提供无状态判定。
// 刻意不依赖任何内部包、不接触数据库，可被 middleware / service 等任意层引用而不产生环。
//
// 边界约定：这里只管「角色的全局动作权限」（如平台级 LLM 管理）。
// 资源级归属（owner == caller，例如“只能改自己的作品”）不属于 RBAC，由 service 层的
// requireOwner / ownerOrNotFound 处理，两套模型分离以免互相污染。
package authz

type Role string

type Permission string

const (
	RoleUser  Role = "user"
	RoleAdmin Role = "admin"
)

const (
	// PermPlatformLLMManage 管理平台级 LLM 设置（原 RequireAdmin 的语义）。
	PermPlatformLLMManage Permission = "platform_llm:manage"
)

// rolePermissions 是角色 → 权限集的唯一事实来源。新增权限只需在此登记。
var rolePermissions = map[Role]map[Permission]bool{
	RoleAdmin: {
		PermPlatformLLMManage: true,
	},
	RoleUser: {},
}

// Can 判断 JWT 快照里的角色字符串是否具备某权限；未知角色返回 false。
func Can(role string, perm Permission) bool {
	return rolePermissions[Role(role)][perm]
}
