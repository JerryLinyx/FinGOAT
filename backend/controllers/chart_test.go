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
