package controllers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

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
