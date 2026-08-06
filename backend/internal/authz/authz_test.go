package authz

import "testing"

func TestCan(t *testing.T) {
	cases := []struct {
		name string
		role string
		perm Permission
		want bool
	}{
		{"admin has platform manage", string(RoleAdmin), PermPlatformLLMManage, true},
		{"user lacks platform manage", string(RoleUser), PermPlatformLLMManage, false},
		{"empty role denied", "", PermPlatformLLMManage, false},
		{"unknown role denied", "superuser", PermPlatformLLMManage, false},
		{"unknown permission denied", string(RoleAdmin), Permission("nope:nope"), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Can(tc.role, tc.perm); got != tc.want {
				t.Errorf("Can(%q, %q) = %v, want %v", tc.role, tc.perm, got, tc.want)
			}
		})
	}
}
