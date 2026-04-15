package controllers

import "testing"

func TestNormalizeTerminalPeriod(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "defaults to day", input: "", want: "day"},
		{name: "keeps week", input: "week", want: "week"},
		{name: "keeps month", input: "month", want: "month"},
		{name: "normalizes case", input: "WEEK", want: "week"},
		{name: "falls back on unknown", input: "quarter", want: "day"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := normalizeTerminalPeriod(tt.input)
			if got != tt.want {
				t.Fatalf("normalizeTerminalPeriod(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
