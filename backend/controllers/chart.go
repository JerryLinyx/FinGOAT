package controllers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type OHLCVPoint struct {
	Date   string  `json:"date"`
	Open   float64 `json:"open"`
	High   float64 `json:"high"`
	Low    float64 `json:"low"`
	Close  float64 `json:"close"`
	Volume float64 `json:"volume"`
}

type chartEndpointConfig struct {
	Function    string
	SeriesKey   string
	VolumeField string
	OutputSize  string
}

func GetStockChart(c *gin.Context) {
	ticker := strings.ToUpper(c.Param("ticker"))
	if ticker == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ticker is required"})
		return
	}

	rangeParam := c.DefaultQuery("range", "3m")

	// Prefer the user's stored Alpha Vantage key; fall back to env var.
	var apiKey string
	if uid, ok := c.Get("user_id"); ok {
		if key, err := lookupDecryptedKey(uid.(uint), "alpha_vantage"); err == nil && key != "" {
			apiKey = key
		}
	}
	if apiKey == "" {
		apiKey = os.Getenv("ALPHA_VANTAGE_API_KEY")
	}
	if apiKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Alpha Vantage API key not configured — add it in Profile & API Keys"})
		return
	}

	endpoint := resolveChartEndpoint(rangeParam)

	url := fmt.Sprintf(
		"https://www.alphavantage.co/query?function=%s&symbol=%s&outputsize=%s&apikey=%s&source=trading_agents",
		endpoint.Function, ticker, endpoint.OutputSize, apiKey,
	)

	resp, err := http.Get(url)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to reach Alpha Vantage"})
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to read Alpha Vantage response"})
		return
	}

	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "invalid response from Alpha Vantage"})
		return
	}

	if info, ok := raw["Information"]; ok {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": fmt.Sprintf("%v", info)})
		return
	}
	if errMsg, ok := raw["Error Message"]; ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("%v", errMsg)})
		return
	}

	timeSeries, ok := raw[endpoint.SeriesKey]
	if !ok {
		c.JSON(http.StatusBadGateway, gin.H{"error": "unexpected Alpha Vantage response format"})
		return
	}

	seriesMap, ok := timeSeries.(map[string]interface{})
	if !ok {
		c.JSON(http.StatusBadGateway, gin.H{"error": "unexpected time series format"})
		return
	}

	cutoff := computeCutoffDate(rangeParam)

	var points []OHLCVPoint
	for dateStr, values := range seriesMap {
		d, err := time.Parse("2006-01-02", dateStr)
		if err != nil {
			continue
		}
		if d.Before(cutoff) {
			continue
		}

		vals, ok := values.(map[string]interface{})
		if !ok {
			continue
		}

		points = append(points, OHLCVPoint{
			Date:   dateStr,
			Open:   parseFloat(vals["1. open"]),
			High:   parseFloat(vals["2. high"]),
			Low:    parseFloat(vals["3. low"]),
			Close:  parseFloat(vals["4. close"]),
			Volume: parseFloat(vals[endpoint.VolumeField]),
		})
	}

	sort.Slice(points, func(i, j int) bool {
		return points[i].Date < points[j].Date
	})

	c.JSON(http.StatusOK, gin.H{
		"ticker": ticker,
		"range":  rangeParam,
		"data":   points,
	})
}

func resolveChartEndpoint(rangeParam string) chartEndpointConfig {
	switch rangeParam {
	case "1y":
		return chartEndpointConfig{
			Function:    "TIME_SERIES_WEEKLY_ADJUSTED",
			SeriesKey:   "Weekly Adjusted Time Series",
			VolumeField: "6. volume",
			OutputSize:  "compact",
		}
	case "5y":
		return chartEndpointConfig{
			Function:    "TIME_SERIES_MONTHLY_ADJUSTED",
			SeriesKey:   "Monthly Adjusted Time Series",
			VolumeField: "6. volume",
			OutputSize:  "compact",
		}
	default:
		return chartEndpointConfig{
			Function:    "TIME_SERIES_DAILY",
			SeriesKey:   "Time Series (Daily)",
			VolumeField: "5. volume",
			OutputSize:  "compact",
		}
	}
}

func computeCutoffDate(rangeParam string) time.Time {
	now := time.Now()
	switch rangeParam {
	case "5d":
		return now.AddDate(0, 0, -7)
	case "1m":
		return now.AddDate(0, -1, 0)
	case "3m":
		return now.AddDate(0, -3, 0)
	case "6m":
		return now.AddDate(0, -6, 0)
	case "1y":
		return now.AddDate(-1, 0, 0)
	case "5y":
		return now.AddDate(-5, 0, 0)
	default:
		return now.AddDate(0, -1, 0)
	}
}

func parseFloat(v interface{}) float64 {
	if v == nil {
		return 0
	}
	s, ok := v.(string)
	if !ok {
		return 0
	}
	var f float64
	fmt.Sscanf(s, "%f", &f)
	return f
}
