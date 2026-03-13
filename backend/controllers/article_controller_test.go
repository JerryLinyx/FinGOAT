package controllers

import (
	"testing"
	"time"

	"github.com/JerryLinyx/FinGOAT/models"
)

func TestNormalizeArticleLinkRemovesTrackingParams(t *testing.T) {
	got := normalizeArticleLink("https://example.com/post/?utm_source=rss&fbclid=abc&id=42#section")
	want := "https://example.com/post?id=42"
	if got != want {
		t.Fatalf("normalizeArticleLink() = %q, want %q", got, want)
	}
}

func TestMatchesArticleFingerprintBySourceTitleAndPublishedAt(t *testing.T) {
	publishedAt := time.Date(2026, 3, 13, 12, 0, 0, 0, time.UTC)
	article := models.Article{
		Title:       "Market update",
		Content:     "Body",
		Preview:     "Body",
		Source:      "Test Feed",
		Link:        "https://example.com/article",
		PublishedAt: &publishedAt,
	}

	matched := matchesArticleFingerprint(article, "Test Feed", rssItem{
		Title:       "Market update",
		Link:        "https://example.com/article?utm_source=rss",
		PublishedAt: &publishedAt,
	}, normalizeArticleLink("https://example.com/article?utm_source=rss"))
	if !matched {
		t.Fatalf("matchesArticleFingerprint() = false, want true")
	}
}
