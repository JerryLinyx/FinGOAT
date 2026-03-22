package controllers

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/JerryLinyx/FinGOAT/models"
	"gorm.io/gorm"
)

func TestShouldFailMissingRuntimeTaskPendingAfterTimeout(t *testing.T) {
	now := time.Date(2026, 3, 13, 12, 0, 0, 0, time.UTC)
	task := &models.TradingAnalysisTask{
		Model: gorm.Model{
			CreatedAt: now.Add(-10 * time.Minute),
			UpdatedAt: now.Add(-10 * time.Minute),
		},
		Status: "pending",
	}

	shouldFail, reason := shouldFailMissingRuntimeTask(task, now)
	if !shouldFail {
		t.Fatalf("expected pending task to be reconciled as failed")
	}
	if !strings.Contains(reason, "pending state") {
		t.Fatalf("expected pending-state reason, got %q", reason)
	}
}

func TestShouldFailMissingRuntimeTaskProcessingAfterTimeout(t *testing.T) {
	now := time.Date(2026, 3, 13, 12, 0, 0, 0, time.UTC)
	task := &models.TradingAnalysisTask{
		Model: gorm.Model{
			CreatedAt: now.Add(-40 * time.Minute),
			UpdatedAt: now.Add(-31 * time.Minute),
		},
		Status: "processing",
	}

	shouldFail, reason := shouldFailMissingRuntimeTask(task, now)
	if !shouldFail {
		t.Fatalf("expected processing task to be reconciled as failed")
	}
	if !strings.Contains(reason, "processing state") {
		t.Fatalf("expected processing-state reason, got %q", reason)
	}
}

func TestShouldNotFailFreshPendingTask(t *testing.T) {
	now := time.Date(2026, 3, 13, 12, 0, 0, 0, time.UTC)
	task := &models.TradingAnalysisTask{
		Model: gorm.Model{
			CreatedAt: now.Add(-30 * time.Second),
			UpdatedAt: now.Add(-30 * time.Second),
		},
		Status: "pending",
	}

	shouldFail, reason := shouldFailMissingRuntimeTask(task, now)
	if shouldFail {
		t.Fatalf("did not expect fresh pending task to be reconciled, got reason %q", reason)
	}
}

func TestShouldIgnoreTerminalTaskStatuses(t *testing.T) {
	now := time.Date(2026, 3, 13, 12, 0, 0, 0, time.UTC)
	task := &models.TradingAnalysisTask{
		Model: gorm.Model{
			CreatedAt: now.Add(-24 * time.Hour),
			UpdatedAt: now.Add(-24 * time.Hour),
		},
		Status: "completed",
	}

	shouldFail, reason := shouldFailMissingRuntimeTask(task, now)
	if shouldFail || reason != "" {
		t.Fatalf("did not expect terminal task to be reconciled, got shouldFail=%v reason=%q", shouldFail, reason)
	}
}

func TestFilterQueuePayloadsByTaskIDRemovesDuplicatesAndKeepsOrder(t *testing.T) {
	payloads := []string{
		`{"task_id":"task-a","ticker":"AAPL"}`,
		`{"task_id":"task-b","ticker":"MSFT"}`,
		`{"task_id":"task-a","ticker":"AAPL"}`,
		`{"task_id":"task-c","ticker":"TSLA"}`,
	}

	filtered, removed := filterQueuePayloadsByTaskID(payloads, "task-a")
	if removed != 2 {
		t.Fatalf("expected 2 removals, got %d", removed)
	}

	expected := []string{
		`{"task_id":"task-b","ticker":"MSFT"}`,
		`{"task_id":"task-c","ticker":"TSLA"}`,
	}
	if len(filtered) != len(expected) {
		t.Fatalf("expected %d payloads, got %d", len(expected), len(filtered))
	}
	for i := range expected {
		if filtered[i] != expected[i] {
			t.Fatalf("payload order mismatch at %d: expected %q got %q", i, expected[i], filtered[i])
		}
	}
}

func TestFilterQueuePayloadsByTaskIDKeepsMalformedPayloads(t *testing.T) {
	payloads := []string{
		`{"task_id":"task-a","ticker":"AAPL"}`,
		`not-json`,
		`{"task_id":"task-b","ticker":"MSFT"}`,
	}

	filtered, removed := filterQueuePayloadsByTaskID(payloads, "task-a")
	if removed != 1 {
		t.Fatalf("expected 1 removal, got %d", removed)
	}
	if len(filtered) != 2 {
		t.Fatalf("expected 2 payloads left, got %d", len(filtered))
	}
	if filtered[0] != "not-json" || filtered[1] != `{"task_id":"task-b","ticker":"MSFT"}` {
		t.Fatalf("unexpected filtered payloads: %v", filtered)
	}
}

func TestQueuePayloadTaskID(t *testing.T) {
	taskID := "demo-task"
	payload := fmt.Sprintf(`{"task_id":"%s","ticker":"AAPL"}`, taskID)
	if got := queuePayloadTaskID(payload); got != taskID {
		t.Fatalf("expected task id %q, got %q", taskID, got)
	}
	if got := queuePayloadTaskID("not-json"); got != "" {
		t.Fatalf("expected malformed payload to return empty task id, got %q", got)
	}
}

func TestValidateAnalysisRequestForCNMarket(t *testing.T) {
	valid := &AnalysisRequest{
		Ticker: "600519",
		Market: "cn",
		Date:   "2026-03-18",
	}
	if got := validateAnalysisRequest(valid); got != "" {
		t.Fatalf("validateAnalysisRequest(valid cn) = %q, want empty", got)
	}

	invalid := &AnalysisRequest{
		Ticker: "AAPL",
		Market: "cn",
		Date:   "2026-03-18",
	}
	if got := validateAnalysisRequest(invalid); got == "" {
		t.Fatalf("expected invalid CN ticker to fail validation")
	}
}

func TestDefaultDataVendorConfigForMarket(t *testing.T) {
	us := defaultDataVendorConfigForMarket("us")
	if us.CoreStockAPIs != "yfinance" || us.NewsData != "alpha_vantage" {
		t.Fatalf("unexpected us defaults: %#v", us)
	}

	cn := defaultDataVendorConfigForMarket("cn")
	if cn.CoreStockAPIs != "akshare" || cn.TechnicalIndicators != "akshare" || cn.FundamentalData != "akshare" || cn.NewsData != "akshare" {
		t.Fatalf("unexpected cn defaults: %#v", cn)
	}
}

func TestMarshalTaskConfigStripsLLMAPIKey(t *testing.T) {
	req := &AnalysisRequest{
		Market:        "us",
		ExecutionMode: "default",
		LLMConfig: &LLMConfig{
			Provider:      "dashscope",
			BaseURL:       "https://dashscope.aliyuncs.com/compatible-mode/v1",
			QuickThinkLLM: "qwen3.5-flash",
			DeepThinkLLM:  "qwen3.5-flash",
			APIKey:        "super-secret-key",
		},
	}

	raw, err := marshalTaskConfig(req)
	if err != nil {
		t.Fatalf("marshalTaskConfig returned error: %v", err)
	}

	if raw == nil {
		t.Fatalf("marshalTaskConfig returned nil payload")
	}

	var decoded map[string]any
	if err := json.Unmarshal([]byte(*raw), &decoded); err != nil {
		t.Fatalf("failed to decode marshalled config: %v", err)
	}

	llmConfig, ok := decoded["llm_config"].(map[string]any)
	if !ok {
		t.Fatalf("expected llm_config in marshalled payload")
	}

	if _, exists := llmConfig["api_key"]; exists {
		t.Fatalf("expected api_key to be stripped from stored task config")
	}
}

func TestParseStagesFromReportPreservesProvider(t *testing.T) {
	report := map[string]interface{}{
		"__stages": []interface{}{
			map[string]interface{}{
				"stage_id":          "market",
				"label":             "Market Analyst",
				"status":            "completed",
				"backend":           "openclaw",
				"provider":          "ollama",
				"summary":           "Market summary",
				"duration_seconds":  2.5,
				"prompt_tokens":     10,
				"completion_tokens": 20,
				"total_tokens":      30,
			},
		},
	}

	stages := parseStagesFromReport(report)
	if len(stages) != 1 {
		t.Fatalf("expected 1 parsed stage, got %d", len(stages))
	}

	if stages[0].Provider != "ollama" {
		t.Fatalf("expected provider %q, got %q", "ollama", stages[0].Provider)
	}
	if stages[0].Backend != "openclaw" {
		t.Fatalf("expected backend %q, got %q", "openclaw", stages[0].Backend)
	}
}
