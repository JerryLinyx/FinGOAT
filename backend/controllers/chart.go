package controllers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
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

type terminalPeriodSpec struct {
	Period   string
	Endpoint chartEndpointConfig
	Cutoff   time.Time
}

func GetStockChart(c *gin.Context) {
	market := normalizeMarket(c.DefaultQuery("market", "us"))
	ticker := normalizeTickerForMarket(c.Param("ticker"), market)
	if err := validateChartTicker(ticker, market); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	rangeParam := c.DefaultQuery("range", "3m")
	apiKey := ""
	if market == "us" {
		resolved, err := resolveAlphaVantageAPIKey(c)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		apiKey = resolved
	}
	proxyMarketDataJSON(c, "/api/v1/chart", map[string]string{
		"ticker": ticker,
		"range":  rangeParam,
		"market": market,
	}, "chart", apiKey)
}

func GetStockTerminal(c *gin.Context) {
	market := normalizeMarket(c.DefaultQuery("market", "us"))
	ticker := normalizeTickerForMarket(c.Param("ticker"), market)
	if err := validateChartTicker(ticker, market); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	period := normalizeTerminalPeriod(c.DefaultQuery("period", "day"))
	apiKey := ""
	if market == "us" {
		resolved, err := resolveAlphaVantageAPIKey(c)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		apiKey = resolved
	}
	params := map[string]string{
		"ticker": ticker,
		"period": period,
		"market": market,
	}
	if before := strings.TrimSpace(c.Query("before")); before != "" {
		params["before"] = before
	}
	proxyMarketDataJSON(c, "/api/v1/terminal", params, "terminal", apiKey)
}

func GetStockQuote(c *gin.Context) {
	market := normalizeMarket(c.DefaultQuery("market", "us"))
	ticker := normalizeTickerForMarket(c.Param("ticker"), market)
	if err := validateChartTicker(ticker, market); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	apiKey := ""
	if market == "us" {
		resolved, err := resolveAlphaVantageAPIKey(c)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		apiKey = resolved
	}
	proxyMarketDataJSON(c, "/api/v1/quote", map[string]string{
		"ticker": ticker,
		"market": market,
	}, "quote", apiKey)
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

func normalizeTerminalPeriod(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "week":
		return "week"
	case "month":
		return "month"
	default:
		return "day"
	}
}

func resolveTerminalPeriodSpec(period string) terminalPeriodSpec {
	now := time.Now()
	switch normalizeTerminalPeriod(period) {
	case "week":
		return terminalPeriodSpec{
			Period: "week",
			Endpoint: chartEndpointConfig{
				Function:    "TIME_SERIES_WEEKLY_ADJUSTED",
				SeriesKey:   "Weekly Adjusted Time Series",
				VolumeField: "6. volume",
				OutputSize:  "compact",
			},
			Cutoff: now.AddDate(-3, 0, 0),
		}
	case "month":
		return terminalPeriodSpec{
			Period: "month",
			Endpoint: chartEndpointConfig{
				Function:    "TIME_SERIES_MONTHLY_ADJUSTED",
				SeriesKey:   "Monthly Adjusted Time Series",
				VolumeField: "6. volume",
				OutputSize:  "compact",
			},
			Cutoff: now.AddDate(-10, 0, 0),
		}
	default:
		return terminalPeriodSpec{
			Period: "day",
			Endpoint: chartEndpointConfig{
				Function:    "TIME_SERIES_DAILY",
				SeriesKey:   "Time Series (Daily)",
				VolumeField: "5. volume",
				OutputSize:  "compact",
			},
			Cutoff: now.AddDate(-1, 0, 0),
		}
	}
}

func validateChartTicker(ticker string, market string) error {
	if ticker == "" {
		return fmt.Errorf("ticker is required")
	}
	if normalizeMarket(market) == "cn" {
		if !cnTickerPattern.MatchString(ticker) {
			return fmt.Errorf("A-share ticker must be a 6-digit stock code")
		}
		if strings.HasPrefix(ticker, "8") {
			return fmt.Errorf("Beijing Stock Exchange tickers are not supported in v1")
		}
		return nil
	}
	if !tickerPattern.MatchString(ticker) {
		return fmt.Errorf("ticker must be 1-10 characters (letters, digits, dots, hyphens)")
	}
	return nil
}

func fetchUSChartPoints(c *gin.Context, ticker string, endpoint chartEndpointConfig, cutoff time.Time) ([]OHLCVPoint, int, error) {
	apiKey, err := resolveAlphaVantageAPIKey(c)
	if err != nil {
		return nil, http.StatusBadRequest, err
	}

	raw, statusCode, err := fetchAlphaVantageSeries(ticker, endpoint, apiKey)
	if err != nil {
		return nil, statusCode, err
	}

	timeSeries, ok := raw[endpoint.SeriesKey]
	if !ok {
		return nil, http.StatusBadGateway, fmt.Errorf("unexpected Alpha Vantage response format")
	}

	seriesMap, ok := timeSeries.(map[string]interface{})
	if !ok {
		return nil, http.StatusBadGateway, fmt.Errorf("unexpected time series format")
	}

	var points []OHLCVPoint
	for dateStr, values := range seriesMap {
		d, err := time.Parse("2006-01-02", dateStr)
		if err != nil || d.Before(cutoff) {
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
	return points, http.StatusOK, nil
}

func resolveAlphaVantageAPIKey(c *gin.Context) (string, error) {
	if uid, ok := c.Get("user_id"); ok {
		if key, err := lookupDecryptedKey(uid.(uint), "alpha_vantage"); err == nil && key != "" {
			return key, nil
		}
	}
	if apiKey := os.Getenv("ALPHA_VANTAGE_API_KEY"); apiKey != "" {
		return apiKey, nil
	}
	return "", fmt.Errorf("Alpha Vantage API key not configured — add it in Profile & API Keys")
}

func fetchAlphaVantageSeries(ticker string, endpoint chartEndpointConfig, apiKey string) (map[string]interface{}, int, error) {
	avURL := fmt.Sprintf(
		"https://www.alphavantage.co/query?function=%s&symbol=%s&outputsize=%s&apikey=%s&source=trading_agents",
		endpoint.Function, ticker, endpoint.OutputSize, apiKey,
	)
	resp, err := http.Get(avURL)
	if err != nil {
		return nil, http.StatusBadGateway, fmt.Errorf("failed to reach Alpha Vantage")
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, http.StatusBadGateway, fmt.Errorf("failed to read Alpha Vantage response")
	}

	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, http.StatusBadGateway, fmt.Errorf("invalid response from Alpha Vantage")
	}
	if info, ok := raw["Information"]; ok {
		return nil, http.StatusTooManyRequests, fmt.Errorf("%v", info)
	}
	if errMsg, ok := raw["Error Message"]; ok {
		return nil, http.StatusBadRequest, fmt.Errorf("%v", errMsg)
	}
	return raw, http.StatusOK, nil
}

func proxyMarketDataJSON(c *gin.Context, upstreamPath string, query map[string]string, endpointLabel string, alphaVantageAPIKey string) {
	upstream, err := url.Parse(fmt.Sprintf("%s%s", marketDataServiceURL, upstreamPath))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to build upstream %s url", endpointLabel)})
		return
	}
	params := upstream.Query()
	for key, value := range query {
		params.Set(key, value)
	}
	upstream.RawQuery = params.Encode()

	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, upstream.String(), nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to build %s proxy request", endpointLabel)})
		return
	}
	if alphaVantageAPIKey != "" {
		req.Header.Set("X-Alpha-Vantage-Key", alphaVantageAPIKey)
	}

	resp, err := tradingHTTPClient.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("failed to reach market data %s service", endpointLabel)})
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("failed to read market data %s response", endpointLabel)})
		return
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message := extractTradingServiceError(body, resp.StatusCode)
		c.JSON(resp.StatusCode, gin.H{"error": message})
		return
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("invalid response from market data %s service", endpointLabel)})
		return
	}
	if _, exists := payload["market"]; !exists {
		if market, ok := query["market"]; ok && market != "" {
			payload["market"] = market
		}
	}
	c.JSON(http.StatusOK, payload)
}

func prevCloseOrNil(point *OHLCVPoint) any {
	if point == nil {
		return nil
	}
	return point.Close
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
