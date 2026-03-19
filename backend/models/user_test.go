package models

import "testing"

func TestNormalizeUserRole(t *testing.T) {
	tests := []struct {
		name string
		role string
		want string
	}{
		{name: "admin stays admin", role: "admin", want: UserRoleAdmin},
		{name: "admin trims and normalizes case", role: " Admin ", want: UserRoleAdmin},
		{name: "empty defaults to user", role: "", want: UserRoleUser},
		{name: "unknown defaults to user", role: "superuser", want: UserRoleUser},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NormalizeUserRole(tt.role); got != tt.want {
				t.Fatalf("NormalizeUserRole(%q) = %q, want %q", tt.role, got, tt.want)
			}
		})
	}
}
