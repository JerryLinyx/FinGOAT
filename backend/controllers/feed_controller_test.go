package controllers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JerryLinyx/FinGOAT/models"
	"gorm.io/gorm"
)

func TestFetchRSSSourceItemsParsesRSS(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Signals</title>
    <item>
      <title>AI rally lifts $NVDA</title>
      <link>https://example.com/post?utm_source=rss</link>
      <description>Investors react to AI demand.</description>
      <guid>item-1</guid>
      <pubDate>Mon, 18 Mar 2026 12:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`))
	}))
	defer server.Close()

	items, err := fetchRSSSourceItems(context.Background(), models.FeedSource{
		Name:      "Signals",
		BaseURL:   server.URL,
		FetchMode: "rss",
	})
	if err != nil {
		t.Fatalf("fetchRSSSourceItems() error = %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("len(items) = %d, want 1", len(items))
	}
	if items[0].Title != "AI rally lifts $NVDA" {
		t.Fatalf("items[0].Title = %q", items[0].Title)
	}
	if items[0].CanonicalURL != "https://example.com/post?utm_source=rss" {
		t.Fatalf("items[0].CanonicalURL = %q", items[0].CanonicalURL)
	}
	if items[0].RawPayload["guid"] != "item-1" {
		t.Fatalf("guid = %#v, want item-1", items[0].RawPayload["guid"])
	}
}

func TestFetchHTMLSourceItemsParsesAnchorsMetaAndDedupes(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(`<html>
<head>
  <meta property="og:description" content="Curated market briefings" />
  <meta property="og:image" content="https://cdn.example.com/cover.jpg" />
  <meta property="article:published_time" content="2026-03-18T10:30:00Z" />
</head>
<body>
  <a href="/posts/ai-market-map">AI market map</a>
  <a href="/posts/ai-market-map?utm_source=feed">AI market map</a>
  <a href="https://example.com/posts/macro-watch">Macro watch</a>
</body>
</html>`))
	}))
	defer server.Close()

	items, err := fetchHTMLSourceItems(context.Background(), models.FeedSource{
		Name:      "HTML Source",
		BaseURL:   server.URL,
		FetchMode: "html",
	})
	if err != nil {
		t.Fatalf("fetchHTMLSourceItems() error = %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("len(items) = %d, want 2", len(items))
	}
	if items[0].Excerpt != "Curated market briefings" {
		t.Fatalf("items[0].Excerpt = %q", items[0].Excerpt)
	}
	if items[0].CoverImageURL != "https://cdn.example.com/cover.jpg" {
		t.Fatalf("items[0].CoverImageURL = %q", items[0].CoverImageURL)
	}
	if items[0].PublishedAt == nil {
		t.Fatalf("items[0].PublishedAt = nil, want parsed time")
	}
	if got := items[0].CanonicalURL; !strings.Contains(got, "/posts/ai-market-map") {
		t.Fatalf("items[0].CanonicalURL = %q", got)
	}
}

func TestFetchSitemapSourceItemsParsesURLSet(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/xml")
		_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/research/earnings-preview</loc>
    <lastmod>2026-03-17T15:04:05Z</lastmod>
  </url>
  <url>
    <loc>https://example.com/research/ai-reset</loc>
  </url>
</urlset>`))
	}))
	defer server.Close()

	items, err := fetchSitemapSourceItems(context.Background(), models.FeedSource{
		Name:      "Sitemap Source",
		BaseURL:   server.URL,
		FetchMode: "sitemap",
	})
	if err != nil {
		t.Fatalf("fetchSitemapSourceItems() error = %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("len(items) = %d, want 2", len(items))
	}
	if items[0].Title != "Earnings Preview" {
		t.Fatalf("items[0].Title = %q", items[0].Title)
	}
	if items[0].PublishedAt == nil {
		t.Fatalf("items[0].PublishedAt = nil, want parsed time")
	}
}

func TestInferFeedTagsExtractsTopicsTickersAndContentType(t *testing.T) {
	topics, tickers, contentType := inferFeedTags(
		models.FeedSource{Name: "AI Wire", SourceType: "ai"},
		"NVIDIA beats estimates as AI demand surges",
		"$NVDA revenue climbs on new model demand",
		"https://example.com/markets/nvidia-ai-demand",
	)

	if len(topics) == 0 || topics[0] != "AI" {
		t.Fatalf("topics = %#v, want AI topic", topics)
	}
	foundTicker := false
	for _, ticker := range tickers {
		if ticker == "NVDA" {
			foundTicker = true
			break
		}
	}
	if !foundTicker {
		t.Fatalf("tickers = %#v, want NVDA", tickers)
	}
	if contentType != "signal" {
		t.Fatalf("contentType = %q, want signal", contentType)
	}
}

func TestComputeFeedScorePrefersFreshPreferredContent(t *testing.T) {
	now := time.Now().UTC()
	newPreferred := computeFeedScore(
		models.FeedItem{Model: gorm.Model{CreatedAt: now.Add(-2 * time.Hour)}},
		8,
		12,
		4,
		true,
		"following",
	)
	oldNeutral := computeFeedScore(
		models.FeedItem{Model: gorm.Model{CreatedAt: now.Add(-72 * time.Hour)}},
		2,
		1,
		0,
		false,
		"for-you",
	)
	if newPreferred <= oldNeutral {
		t.Fatalf("newPreferred = %f, oldNeutral = %f, want newPreferred > oldNeutral", newPreferred, oldNeutral)
	}
}
