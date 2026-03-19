package controllers

import "testing"

func TestResolveChartEndpoint(t *testing.T) {
	tests := []struct {
		name       string
		rangeParam string
		want       chartEndpointConfig
	}{
		{
			name:       "five day uses free daily",
			rangeParam: "5d",
			want: chartEndpointConfig{
				Function:    "TIME_SERIES_DAILY",
				SeriesKey:   "Time Series (Daily)",
				VolumeField: "5. volume",
				OutputSize:  "compact",
			},
		},
		{
			name:       "one month uses free daily",
			rangeParam: "1m",
			want: chartEndpointConfig{
				Function:    "TIME_SERIES_DAILY",
				SeriesKey:   "Time Series (Daily)",
				VolumeField: "5. volume",
				OutputSize:  "compact",
			},
		},
		{
			name:       "default short range uses free daily",
			rangeParam: "3m",
			want: chartEndpointConfig{
				Function:    "TIME_SERIES_DAILY",
				SeriesKey:   "Time Series (Daily)",
				VolumeField: "5. volume",
				OutputSize:  "compact",
			},
		},
		{
			name:       "one year uses weekly adjusted",
			rangeParam: "1y",
			want: chartEndpointConfig{
				Function:    "TIME_SERIES_WEEKLY_ADJUSTED",
				SeriesKey:   "Weekly Adjusted Time Series",
				VolumeField: "6. volume",
				OutputSize:  "compact",
			},
		},
		{
			name:       "five years uses monthly adjusted",
			rangeParam: "5y",
			want: chartEndpointConfig{
				Function:    "TIME_SERIES_MONTHLY_ADJUSTED",
				SeriesKey:   "Monthly Adjusted Time Series",
				VolumeField: "6. volume",
				OutputSize:  "compact",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolveChartEndpoint(tt.rangeParam)
			if got != tt.want {
				t.Fatalf("resolveChartEndpoint(%q) = %#v, want %#v", tt.rangeParam, got, tt.want)
			}
		})
	}
}

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

func TestResolveTerminalPeriodSpec(t *testing.T) {
	tests := []struct {
		name         string
		period       string
		wantPeriod   string
		wantFunction string
	}{
		{name: "day uses daily", period: "day", wantPeriod: "day", wantFunction: "TIME_SERIES_DAILY"},
		{name: "week uses weekly", period: "week", wantPeriod: "week", wantFunction: "TIME_SERIES_WEEKLY_ADJUSTED"},
		{name: "month uses monthly", period: "month", wantPeriod: "month", wantFunction: "TIME_SERIES_MONTHLY_ADJUSTED"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolveTerminalPeriodSpec(tt.period)
			if got.Period != tt.wantPeriod {
				t.Fatalf("resolveTerminalPeriodSpec(%q) period = %q, want %q", tt.period, got.Period, tt.wantPeriod)
			}
			if got.Endpoint.Function != tt.wantFunction {
				t.Fatalf("resolveTerminalPeriodSpec(%q) function = %q, want %q", tt.period, got.Endpoint.Function, tt.wantFunction)
			}
		})
	}
}
