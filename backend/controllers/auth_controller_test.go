package controllers

import "testing"

func TestNormalizeEmail(t *testing.T) {
	email, ok := normalizeEmail("  Alice@Example.com ")
	if !ok {
		t.Fatalf("expected normalizeEmail() success")
	}
	if email != "alice@example.com" {
		t.Fatalf("normalizeEmail() = %q, want %q", email, "alice@example.com")
	}
}

func TestNormalizeEmailRejectsInvalidValues(t *testing.T) {
	if _, ok := normalizeEmail("alice.example.com"); ok {
		t.Fatalf("expected invalid email to be rejected")
	}
}

func TestResolveLoginIdentifierPrefersIdentifierThenEmailThenUsername(t *testing.T) {
	tests := []struct {
		name  string
		input LoginInput
		want  string
	}{
		{
			name:  "identifier wins",
			input: LoginInput{Identifier: "primary", Email: "email@example.com", Username: "legacy"},
			want:  "primary",
		},
		{
			name:  "email fallback",
			input: LoginInput{Email: "email@example.com", Username: "legacy"},
			want:  "email@example.com",
		},
		{
			name:  "username fallback",
			input: LoginInput{Username: "legacy"},
			want:  "legacy",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := resolveLoginIdentifier(tt.input); got != tt.want {
				t.Fatalf("resolveLoginIdentifier() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestSanitizeUsernameBase(t *testing.T) {
	if got := sanitizeUsernameBase("john.doe+test@example.com"); got != "johndoetest" {
		t.Fatalf("sanitizeUsernameBase() = %q, want %q", got, "johndoetest")
	}
	if got := sanitizeUsernameBase("@example.com"); got != "user" {
		t.Fatalf("sanitizeUsernameBase() fallback = %q, want %q", got, "user")
	}
}

func TestNormalizeProfileEmail(t *testing.T) {
	raw := "  ALICE@Example.com "
	email, err := normalizeProfileEmail(&raw)
	if err != nil {
		t.Fatalf("normalizeProfileEmail() error = %v", err)
	}
	if email == nil || *email != "alice@example.com" {
		t.Fatalf("normalizeProfileEmail() = %v, want alice@example.com", email)
	}
}

func TestNormalizeProfileEmailAllowsClearing(t *testing.T) {
	raw := "   "
	email, err := normalizeProfileEmail(&raw)
	if err != nil {
		t.Fatalf("normalizeProfileEmail() error = %v", err)
	}
	if email != nil {
		t.Fatalf("normalizeProfileEmail() = %v, want nil", email)
	}
}

func TestProfileEmailChanged(t *testing.T) {
	current := "alice@example.com"
	same := "alice@example.com"
	changed := "bob@example.com"

	tests := []struct {
		name    string
		current *string
		next    *string
		want    bool
	}{
		{name: "both nil", current: nil, next: nil, want: false},
		{name: "set from nil", current: nil, next: &current, want: true},
		{name: "cleared", current: &current, next: nil, want: true},
		{name: "same value", current: &current, next: &same, want: false},
		{name: "different value", current: &current, next: &changed, want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := profileEmailChanged(tt.current, tt.next); got != tt.want {
				t.Fatalf("profileEmailChanged() = %v, want %v", got, tt.want)
			}
		})
	}
}
