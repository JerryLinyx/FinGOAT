package controllers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type ollamaTagsResponse struct {
	Models []struct {
		Name       string `json:"name"`
		ModifiedAt string `json:"modified_at"`
		Size       int64  `json:"size"`
	} `json:"models"`
}

func normalizeOllamaBaseURL(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "http://localhost:11434"
	}

	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "http://localhost:11434"
	}

	parsed.Path = strings.TrimSuffix(parsed.Path, "/")
	parsed.Path = strings.TrimSuffix(parsed.Path, "/v1")
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return strings.TrimRight(parsed.String(), "/")
}

// GetOllamaModels proxies a lightweight model discovery call to the configured
// Ollama host so the frontend can list already-downloaded local models.
func GetOllamaModels(c *gin.Context) {
	baseURL := normalizeOllamaBaseURL(c.Query("base_url"))
	client := &http.Client{Timeout: 5 * time.Second}

	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, baseURL+"/api/tags", nil)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ollama host"})
		return
	}

	resp, err := client.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("failed to connect to ollama host: %v", err)})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("ollama host returned status %d", resp.StatusCode)})
		return
	}

	var payload ollamaTagsResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to decode ollama model list"})
		return
	}

	models := make([]gin.H, 0, len(payload.Models))
	for _, model := range payload.Models {
		models = append(models, gin.H{
			"name":        model.Name,
			"modified_at": model.ModifiedAt,
			"size":        model.Size,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"base_url": baseURL,
		"models":   models,
	})
}
