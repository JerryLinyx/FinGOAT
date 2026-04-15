package controllers

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/JerryLinyx/FinGOAT/global"
	"github.com/JerryLinyx/FinGOAT/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	feedBoardCacheTTL      = 45 * time.Second
	feedSchedulerInterval  = 20 * time.Minute
	feedSchedulerStartWait = 5 * time.Second
	feedCandidateWindow    = 240
)

var (
	feedHTMLTitleRegex       = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	feedHTMLAnchorRegex      = regexp.MustCompile(`(?is)<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)</a>`)
	feedHTMLStripRegex       = regexp.MustCompile(`(?is)<[^>]*>`)
	feedHTMLTagRegex         = regexp.MustCompile(`<[^>]*>`)
	feedMetaPropertyTemplate = `(?is)<meta[^>]+(?:property|name)=["']%s["'][^>]+content=["']([^"']+)["'][^>]*>`
	feedTimeDatetimeRegex    = regexp.MustCompile(`(?is)<time[^>]+datetime=["']([^"']+)["'][^>]*>`)
	feedTickerDollarRegex    = regexp.MustCompile(`\$([A-Z]{1,5})(?:\b|$)`)
	feedTickerWordRegex      = regexp.MustCompile(`\b[A-Z]{2,5}\b`)
	feedHTTPClient           = &http.Client{Timeout: 10 * time.Second}
	feedSchedulerOnce        sync.Once
	feedTrackingPrefixes     = []string{"utm_"}
	feedTrackingKeys         = map[string]struct{}{
		"fbclid":  {},
		"gclid":   {},
		"mc_cid":  {},
		"mc_eid":  {},
		"ref":     {},
		"ref_src": {},
		"source":  {},
		"spm":     {},
		"from":    {},
	}
)

type fetchedFeedItem struct {
	Title         string
	Excerpt       string
	CanonicalURL  string
	CoverImageURL string
	AuthorText    string
	PublishedAt   *time.Time
	RawPayload    map[string]interface{}
}

type feedBoardItemResponse struct {
	ID             uint       `json:"id"`
	Title          string     `json:"title"`
	Excerpt        string     `json:"excerpt"`
	CanonicalURL   string     `json:"canonical_url"`
	CoverImageURL  string     `json:"cover_image_url,omitempty"`
	PublishedAt    *time.Time `json:"published_at,omitempty"`
	SourceID       uint       `json:"source_id"`
	SourceName     string     `json:"source_name"`
	SourceType     string     `json:"source_type"`
	PrimaryTopic   string     `json:"primary_topic,omitempty"`
	PrimaryTicker  string     `json:"primary_ticker,omitempty"`
	ContentType    string     `json:"content_type"`
	Topics         []string   `json:"topics,omitempty"`
	Tickers        []string   `json:"tickers,omitempty"`
	LikeCount      int64      `json:"like_count"`
	SaveCount      int64      `json:"save_count"`
	Liked          bool       `json:"liked"`
	Saved          bool       `json:"saved"`
	PreferenceHit  bool       `json:"preference_hit"`
	SourcePriority int        `json:"source_priority"`
}

type feedBoardResponse struct {
	Items      []feedBoardItemResponse `json:"items"`
	NextCursor string                  `json:"next_cursor,omitempty"`
}

type feedPreferencesPayload struct {
	Topics  []string `json:"topics"`
	Tickers []string `json:"tickers"`
	Sources []string `json:"sources"`
}

type feedSourceResponse struct {
	ID         uint   `json:"id"`
	Name       string `json:"name"`
	BaseURL    string `json:"base_url"`
	SourceType string `json:"source_type"`
	FetchMode  string `json:"fetch_mode"`
	Priority   int    `json:"priority"`
}

type feedPreferenceSets struct {
	Topics  map[string]struct{}
	Tickers map[string]struct{}
	Sources map[string]struct{}
}

type sitemapURLSet struct {
	URLs []struct {
		Loc     string `xml:"loc"`
		LastMod string `xml:"lastmod"`
	} `xml:"url"`
}

type sitemapIndex struct {
	Sitemaps []struct {
		Loc string `xml:"loc"`
	} `xml:"sitemap"`
}

type rssItem struct {
	Title       string
	Link        string
	Description string
	PublishedAt *time.Time
	GUID        string
}

type rssEnvelope struct {
	Channel struct {
		Items []struct {
			Title       string `xml:"title"`
			Link        string `xml:"link"`
			Description string `xml:"description"`
			GUID        string `xml:"guid"`
			PubDate     string `xml:"pubDate"`
		} `xml:"item"`
	} `xml:"channel"`
}

type atomLink struct {
	Href string `xml:"href,attr"`
}

type atomEnvelope struct {
	Entries []struct {
		Title     string     `xml:"title"`
		Links     []atomLink `xml:"link"`
		Summary   string     `xml:"summary"`
		Content   string     `xml:"content"`
		ID        string     `xml:"id"`
		Updated   string     `xml:"updated"`
		Published string     `xml:"published"`
	} `xml:"entry"`
}

var defaultFeedSources = []models.FeedSource{
	{
		Name:       "Google AI Blog",
		BaseURL:    "https://ai.googleblog.com/feeds/posts/default?alt=rss",
		SourceType: "ai",
		FetchMode:  "rss",
		Active:     true,
		Priority:   85,
	},
	{
		Name:       "OpenAI News",
		BaseURL:    "https://openai.com/news/rss.xml",
		SourceType: "ai",
		FetchMode:  "rss",
		Active:     true,
		Priority:   90,
	},
	{
		Name:       "Anthropic News",
		BaseURL:    "https://www.anthropic.com/news/rss.xml",
		SourceType: "ai",
		FetchMode:  "rss",
		Active:     true,
		Priority:   82,
	},
	{
		Name:       "Sequoia Capital",
		BaseURL:    "https://www.sequoiacap.com/feed/",
		SourceType: "macro",
		FetchMode:  "rss",
		Active:     true,
		Priority:   78,
	},
	{
		Name:       "YC Blog",
		BaseURL:    "https://www.ycombinator.com/blog/feed",
		SourceType: "macro",
		FetchMode:  "rss",
		Active:     true,
		Priority:   74,
	},
	{
		Name:       "The Pragmatic Engineer",
		BaseURL:    "https://newsletter.pragmaticengineer.com/feed",
		SourceType: "stocks",
		FetchMode:  "rss",
		Active:     true,
		Priority:   72,
	},
}

func StartFeedScheduler(ctx context.Context) {
	feedSchedulerOnce.Do(func() {
		go func() {
			timer := time.NewTimer(feedSchedulerStartWait)
			defer timer.Stop()

			select {
			case <-ctx.Done():
				return
			case <-timer.C:
			}

			runFeedIngestCycle(context.Background())

			ticker := time.NewTicker(feedSchedulerInterval)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					runFeedIngestCycle(context.Background())
				}
			}
		}()
	})
}

func ensureDefaultFeedSources(ctx context.Context) error {
	for _, source := range defaultFeedSources {
		record := source
		if err := global.DB.WithContext(ctx).
			Where("base_url = ?", source.BaseURL).
			Assign(models.FeedSource{
				Name:       source.Name,
				SourceType: source.SourceType,
				FetchMode:  source.FetchMode,
				Active:     true,
				Priority:   source.Priority,
			}).
			FirstOrCreate(&record).Error; err != nil {
			return err
		}
	}
	return nil
}

func normalizeArticleLink(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return trimmed
	}

	parsed.Fragment = ""
	query := parsed.Query()
	for key := range query {
		lowerKey := strings.ToLower(key)
		if _, tracked := feedTrackingKeys[lowerKey]; tracked {
			query.Del(key)
			continue
		}
		for _, prefix := range feedTrackingPrefixes {
			if strings.HasPrefix(lowerKey, prefix) {
				query.Del(key)
				break
			}
		}
	}
	parsed.RawQuery = query.Encode()
	if parsed.Path != "/" {
		parsed.Path = strings.TrimRight(parsed.Path, "/")
	}
	return parsed.String()
}

func parseTimeString(value string) *time.Time {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	layouts := []string{
		time.RFC3339,
		time.RFC3339Nano,
		time.RFC1123Z,
		time.RFC1123,
		time.RFC850,
		"Mon, 02 Jan 2006 15:04:05 -0700",
		"Mon, 2 Jan 2006 15:04:05 -0700",
	}
	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, value); err == nil {
			return &parsed
		}
	}
	return nil
}

func sanitize(text string) string {
	clean := feedHTMLTagRegex.ReplaceAllString(text, "")
	clean = strings.ReplaceAll(clean, "\n", " ")
	clean = strings.ReplaceAll(clean, "\r", " ")
	return strings.TrimSpace(clean)
}

func truncate(text string, maxLen int) string {
	if len(text) <= maxLen {
		return text
	}
	if maxLen <= 3 {
		return text[:maxLen]
	}
	return text[:maxLen-3] + "..."
}

func parseRSS(data []byte) ([]rssItem, error) {
	var rss rssEnvelope
	if err := xml.Unmarshal(data, &rss); err != nil {
		return nil, err
	}

	items := make([]rssItem, 0, len(rss.Channel.Items))
	for _, item := range rss.Channel.Items {
		link := strings.TrimSpace(item.Link)
		title := strings.TrimSpace(item.Title)
		if link == "" || title == "" {
			continue
		}
		items = append(items, rssItem{
			Title:       title,
			Link:        link,
			Description: item.Description,
			PublishedAt: parseTimeString(item.PubDate),
			GUID:        strings.TrimSpace(item.GUID),
		})
	}
	return items, nil
}

func parseAtom(data []byte) ([]rssItem, error) {
	var atom atomEnvelope
	if err := xml.Unmarshal(data, &atom); err != nil {
		return nil, err
	}

	items := make([]rssItem, 0, len(atom.Entries))
	for _, entry := range atom.Entries {
		link := ""
		for _, candidate := range entry.Links {
			if strings.TrimSpace(candidate.Href) != "" {
				link = strings.TrimSpace(candidate.Href)
				break
			}
		}
		if link == "" {
			continue
		}
		title := strings.TrimSpace(entry.Title)
		if title == "" {
			continue
		}
		published := parseTimeString(entry.Published)
		if published == nil {
			published = parseTimeString(entry.Updated)
		}
		description := entry.Summary
		if description == "" {
			description = entry.Content
		}
		items = append(items, rssItem{
			Title:       title,
			Link:        link,
			Description: description,
			PublishedAt: published,
			GUID:        strings.TrimSpace(entry.ID),
		})
	}
	return items, nil
}

func runFeedIngestCycle(ctx context.Context) {
	if err := ensureDefaultFeedSources(ctx); err != nil {
		return
	}

	var sources []models.FeedSource
	if err := global.DB.WithContext(ctx).
		Where("active = ?", true).
		Order("priority DESC, id ASC").
		Find(&sources).Error; err != nil {
		return
	}

	for _, source := range sources {
		_ = ingestFeedSource(ctx, source)
	}
}

func ingestFeedSource(ctx context.Context, source models.FeedSource) error {
	items, err := fetchSourceItems(ctx, source)
	now := time.Now()
	defer func() {
		_ = global.DB.WithContext(context.Background()).
			Model(&models.FeedSource{}).
			Where("id = ?", source.ID).
			Update("last_fetched", &now).Error
	}()
	if err != nil {
		return err
	}
	for _, item := range items {
		if strings.TrimSpace(item.CanonicalURL) == "" || strings.TrimSpace(item.Title) == "" {
			continue
		}

		canonicalURL := normalizeArticleLink(item.CanonicalURL)
		if canonicalURL == "" {
			continue
		}

		excerpt := truncate(sanitize(item.Excerpt), 220)
		if excerpt == "" {
			excerpt = truncate(sanitize(item.Title), 220)
		}

		topics, tickers, contentType := inferFeedTags(source, item.Title, excerpt, canonicalURL)
		primaryTopic := ""
		if len(topics) > 0 {
			primaryTopic = topics[0]
		}
		primaryTicker := ""
		if len(tickers) > 0 {
			primaryTicker = tickers[0]
		}

		payloadBytes, _ := json.Marshal(item.RawPayload)
		rawPayload := string(payloadBytes)
		fingerprint := fingerprintFeedItem(source.Name, item.Title, canonicalURL, excerpt)

		var existing models.FeedItem
		err := global.DB.WithContext(ctx).
			Where("canonical_url = ? OR fingerprint = ?", canonicalURL, fingerprint).
			First(&existing).Error
		switch {
		case err == nil:
			updateFields := map[string]interface{}{
				"title":           item.Title,
				"excerpt":         excerpt,
				"cover_image_url": strings.TrimSpace(item.CoverImageURL),
				"author_text":     strings.TrimSpace(item.AuthorText),
				"raw_payload":     rawPayload,
				"primary_topic":   primaryTopic,
				"primary_ticker":  primaryTicker,
				"content_type":    contentType,
				"source_id":       source.ID,
			}
			if item.PublishedAt != nil {
				updateFields["published_at"] = item.PublishedAt
			}
			if err := global.DB.WithContext(ctx).Model(&existing).Updates(updateFields).Error; err != nil {
				continue
			}
			syncFeedTags(ctx, existing.ID, topics, tickers, contentType)
		case errors.Is(err, gorm.ErrRecordNotFound):
			newItem := models.FeedItem{
				SourceID:      source.ID,
				Title:         item.Title,
				Excerpt:       excerpt,
				CanonicalURL:  canonicalURL,
				CoverImageURL: strings.TrimSpace(item.CoverImageURL),
				AuthorText:    strings.TrimSpace(item.AuthorText),
				PublishedAt:   item.PublishedAt,
				Fingerprint:   fingerprint,
				RawPayload:    &rawPayload,
				PrimaryTopic:  primaryTopic,
				PrimaryTicker: primaryTicker,
				ContentType:   contentType,
			}
			if err := global.DB.WithContext(ctx).Create(&newItem).Error; err != nil {
				continue
			}
			syncFeedTags(ctx, newItem.ID, topics, tickers, contentType)
		}
	}
	return nil
}

func fetchSourceItems(ctx context.Context, source models.FeedSource) ([]fetchedFeedItem, error) {
	switch strings.ToLower(strings.TrimSpace(source.FetchMode)) {
	case "html":
		return fetchHTMLSourceItems(ctx, source)
	case "sitemap":
		return fetchSitemapSourceItems(ctx, source)
	default:
		return fetchRSSSourceItems(ctx, source)
	}
}

func fetchRSSSourceItems(ctx context.Context, source models.FeedSource) ([]fetchedFeedItem, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source.BaseURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := feedHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}

	var root struct {
		XMLName xml.Name
	}
	if err := xml.Unmarshal(data, &root); err != nil {
		return nil, err
	}

	var items []rssItem
	switch strings.ToLower(root.XMLName.Local) {
	case "feed":
		items, err = parseAtom(data)
	default:
		items, err = parseRSS(data)
	}
	if err != nil {
		return nil, err
	}

	results := make([]fetchedFeedItem, 0, len(items))
	for _, item := range items {
		results = append(results, fetchedFeedItem{
			Title:        strings.TrimSpace(item.Title),
			Excerpt:      item.Description,
			CanonicalURL: strings.TrimSpace(item.Link),
			PublishedAt:  item.PublishedAt,
			RawPayload: map[string]interface{}{
				"guid":        item.GUID,
				"source_name": source.Name,
				"fetch_mode":  source.FetchMode,
			},
		})
	}
	return results, nil
}

func fetchHTMLSourceItems(ctx context.Context, source models.FeedSource) ([]fetchedFeedItem, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source.BaseURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := feedHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	html := string(body)
	title := firstNonEmpty(
		findHTMLMeta(html, "og:title"),
		findHTMLMeta(html, "twitter:title"),
		extractHTMLTitle(html),
	)
	excerpt := firstNonEmpty(
		findHTMLMeta(html, "description"),
		findHTMLMeta(html, "og:description"),
		findHTMLMeta(html, "twitter:description"),
	)
	cover := firstNonEmpty(
		findHTMLMeta(html, "og:image"),
		findHTMLMeta(html, "twitter:image"),
	)
	published := parseTimeString(firstNonEmpty(
		findHTMLMeta(html, "article:published_time"),
		extractHTMLTime(html),
	))

	results := []fetchedFeedItem{}
	for _, match := range feedHTMLAnchorRegex.FindAllStringSubmatch(html, 8) {
		href := strings.TrimSpace(htmlUnescape(match[1]))
		text := truncate(sanitize(htmlUnescape(match[2])), 160)
		resolved := resolveSourceLink(source.BaseURL, href)
		if resolved == "" || text == "" {
			continue
		}
		results = append(results, fetchedFeedItem{
			Title:         text,
			Excerpt:       excerpt,
			CanonicalURL:  resolved,
			CoverImageURL: cover,
			PublishedAt:   published,
			RawPayload: map[string]interface{}{
				"fetch_mode": "html",
				"source_url": source.BaseURL,
			},
		})
	}
	if len(results) > 0 {
		return dedupeFetchedItems(results), nil
	}
	if title == "" {
		return nil, nil
	}
	return []fetchedFeedItem{{
		Title:         title,
		Excerpt:       excerpt,
		CanonicalURL:  source.BaseURL,
		CoverImageURL: cover,
		PublishedAt:   published,
		RawPayload: map[string]interface{}{
			"fetch_mode": "html",
			"source_url": source.BaseURL,
		},
	}}, nil
}

func fetchSitemapSourceItems(ctx context.Context, source models.FeedSource) ([]fetchedFeedItem, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source.BaseURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := feedHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}

	var urlSet sitemapURLSet
	if err := xml.Unmarshal(data, &urlSet); err == nil && len(urlSet.URLs) > 0 {
		return mapSitemapURLs(urlSet.URLs), nil
	}
	var index sitemapIndex
	if err := xml.Unmarshal(data, &index); err == nil && len(index.Sitemaps) > 0 {
		results := make([]fetchedFeedItem, 0, len(index.Sitemaps))
		for _, entry := range index.Sitemaps {
			u := strings.TrimSpace(entry.Loc)
			if u == "" {
				continue
			}
			results = append(results, fetchedFeedItem{
				Title:        deriveTitleFromURL(u),
				Excerpt:      "Discovered from sitemap source.",
				CanonicalURL: u,
				RawPayload: map[string]interface{}{
					"fetch_mode": "sitemap_index",
				},
			})
		}
		return results, nil
	}
	return nil, errors.New("unsupported sitemap format")
}

func mapSitemapURLs(entries []struct {
	Loc     string `xml:"loc"`
	LastMod string `xml:"lastmod"`
}) []fetchedFeedItem {
	results := make([]fetchedFeedItem, 0, len(entries))
	for _, entry := range entries {
		u := strings.TrimSpace(entry.Loc)
		if u == "" {
			continue
		}
		results = append(results, fetchedFeedItem{
			Title:        deriveTitleFromURL(u),
			Excerpt:      "Discovered from sitemap source.",
			CanonicalURL: u,
			PublishedAt:  parseTimeString(entry.LastMod),
			RawPayload: map[string]interface{}{
				"fetch_mode": "sitemap",
			},
		})
	}
	return results
}

func dedupeFetchedItems(items []fetchedFeedItem) []fetchedFeedItem {
	seen := make(map[string]struct{}, len(items))
	result := make([]fetchedFeedItem, 0, len(items))
	for _, item := range items {
		key := normalizeArticleLink(item.CanonicalURL)
		if key == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, item)
	}
	return result
}

func resolveSourceLink(baseURL, href string) string {
	href = strings.TrimSpace(href)
	if href == "" {
		return ""
	}
	parsedHref, err := url.Parse(href)
	if err == nil && parsedHref.IsAbs() {
		return parsedHref.String()
	}
	base, err := url.Parse(baseURL)
	if err != nil {
		return href
	}
	ref, err := url.Parse(href)
	if err != nil {
		return href
	}
	return base.ResolveReference(ref).String()
}

func deriveTitleFromURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "Source item"
	}
	path := strings.Trim(parsed.Path, "/")
	if path == "" {
		return parsed.Host
	}
	parts := strings.Split(path, "/")
	last := parts[len(parts)-1]
	last = strings.TrimSpace(strings.ReplaceAll(last, "-", " "))
	last = strings.TrimSpace(strings.ReplaceAll(last, "_", " "))
	if last == "" {
		return parsed.Host
	}
	return strings.Title(last)
}

func fingerprintFeedItem(sourceName, title, canonicalURL, excerpt string) string {
	sum := sha1.Sum([]byte(strings.ToLower(strings.Join([]string{
		strings.TrimSpace(sourceName),
		strings.TrimSpace(title),
		strings.TrimSpace(normalizeArticleLink(canonicalURL)),
		strings.TrimSpace(excerpt),
	}, "|"))))
	return hex.EncodeToString(sum[:])
}

func syncFeedTags(ctx context.Context, itemID uint, topics, tickers []string, contentType string) {
	_ = global.DB.WithContext(ctx).Where("item_id = ?", itemID).Delete(&models.FeedTag{}).Error
	tags := make([]models.FeedTag, 0, len(topics)+len(tickers)+1)
	for _, topic := range topics {
		tags = append(tags, models.FeedTag{ItemID: itemID, Kind: "topic", Value: topic})
	}
	for _, ticker := range tickers {
		tags = append(tags, models.FeedTag{ItemID: itemID, Kind: "ticker", Value: ticker})
	}
	if contentType != "" {
		tags = append(tags, models.FeedTag{ItemID: itemID, Kind: "content_type", Value: contentType})
	}
	if len(tags) > 0 {
		_ = global.DB.WithContext(ctx).Create(&tags).Error
	}
}

func inferFeedTags(source models.FeedSource, title, excerpt, canonicalURL string) ([]string, []string, string) {
	text := strings.ToLower(strings.Join([]string{title, excerpt, canonicalURL, source.Name, source.SourceType}, " "))
	topicScores := []struct {
		topic string
		terms []string
	}{
		{topic: "AI", terms: []string{"ai", "llm", "model", "agents", "foundation model", "genai", "artificial intelligence"}},
		{topic: "Macro", terms: []string{"macro", "inflation", "rates", "yield", "fed", "economy", "geopolitics"}},
		{topic: "Earnings", terms: []string{"earnings", "quarter", "revenue", "guidance", "eps"}},
		{topic: "Stocks", terms: []string{"stock", "shares", "market", "nasdaq", "nyse", "investor"}},
	}

	topics := make([]string, 0, 3)
	for _, candidate := range topicScores {
		for _, term := range candidate.terms {
			if strings.Contains(text, term) {
				topics = append(topics, candidate.topic)
				break
			}
		}
	}
	if len(topics) == 0 {
		switch strings.ToLower(source.SourceType) {
		case "macro", "stocks", "earnings", "ai":
			topics = append(topics, strings.Title(strings.ToLower(source.SourceType)))
		default:
			topics = append(topics, "Signals")
		}
	}

	tickers := extractTickers(title + " " + excerpt)
	contentType := "article"
	if len(tickers) > 0 {
		contentType = "signal"
	} else if containsAny(text, []string{"earnings", "guidance", "quarter"}) {
		contentType = "earnings"
	}

	return uniqueStrings(topics), uniqueStrings(tickers), contentType
}

func extractTickers(text string) []string {
	matches := feedTickerDollarRegex.FindAllStringSubmatch(text, -1)
	results := make([]string, 0, len(matches))
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		results = append(results, strings.ToUpper(match[1]))
	}
	if len(results) > 0 {
		return uniqueStrings(results)
	}

	stopwords := map[string]struct{}{
		"AI": {}, "CEO": {}, "GDP": {}, "ETF": {}, "IPO": {}, "USD": {}, "LLM": {}, "SEC": {},
	}
	for _, token := range feedTickerWordRegex.FindAllString(text, -1) {
		if _, blocked := stopwords[token]; blocked {
			continue
		}
		if len(token) >= 2 && len(token) <= 5 {
			results = append(results, token)
		}
	}
	return uniqueStrings(results)
}

func containsAny(text string, candidates []string) bool {
	for _, candidate := range candidates {
		if strings.Contains(text, candidate) {
			return true
		}
	}
	return false
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	return result
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(htmlUnescape(value)); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func findHTMLMeta(html, name string) string {
	re := regexp.MustCompile(fmt.Sprintf(feedMetaPropertyTemplate, regexp.QuoteMeta(name)))
	match := re.FindStringSubmatch(html)
	if len(match) < 2 {
		return ""
	}
	return match[1]
}

func extractHTMLTitle(html string) string {
	match := feedHTMLTitleRegex.FindStringSubmatch(html)
	if len(match) < 2 {
		return ""
	}
	return sanitize(match[1])
}

func extractHTMLTime(html string) string {
	match := feedTimeDatetimeRegex.FindStringSubmatch(html)
	if len(match) < 2 {
		return ""
	}
	return match[1]
}

func htmlUnescape(value string) string {
	replacer := strings.NewReplacer(
		"&amp;", "&",
		"&quot;", "\"",
		"&#39;", "'",
		"&lt;", "<",
		"&gt;", ">",
		"&nbsp;", " ",
	)
	return replacer.Replace(value)
}

func loadFeedPreferences(ctx context.Context, userID uint) (feedPreferenceSets, error) {
	result := feedPreferenceSets{
		Topics:  map[string]struct{}{},
		Tickers: map[string]struct{}{},
		Sources: map[string]struct{}{},
	}
	var prefs []models.UserFeedPreference
	if err := global.DB.WithContext(ctx).Where("user_id = ?", userID).Find(&prefs).Error; err != nil {
		return result, err
	}
	for _, pref := range prefs {
		switch pref.PrefType {
		case "topic":
			result.Topics[pref.Value] = struct{}{}
		case "ticker":
			result.Tickers[pref.Value] = struct{}{}
		case "source":
			result.Sources[pref.Value] = struct{}{}
		}
	}
	return result, nil
}

func preferencePayloadFromSets(prefs feedPreferenceSets) feedPreferencesPayload {
	return feedPreferencesPayload{
		Topics:  sortedSetKeys(prefs.Topics),
		Tickers: sortedSetKeys(prefs.Tickers),
		Sources: sortedSetKeys(prefs.Sources),
	}
}

func sortedSetKeys(values map[string]struct{}) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func feedCacheKey(userID uint, tab, topic, ticker, source, cursor string, limit int) string {
	return fmt.Sprintf("feed:board:%d:%s:%s:%s:%s:%s:%d", userID, tab, topic, ticker, source, cursor, limit)
}

func invalidateFeedBoardCache(ctx context.Context) {
	var cursor uint64
	for {
		keys, nextCursor, err := global.RedisDB.Scan(ctx, cursor, "feed:board:*", 200).Result()
		if err != nil {
			return
		}
		if len(keys) > 0 {
			_ = global.RedisDB.Del(ctx, keys...).Err()
		}
		if nextCursor == 0 {
			return
		}
		cursor = nextCursor
	}
}

func GetFeedSources(c *gin.Context) {
	var sources []models.FeedSource
	if err := global.DB.WithContext(c.Request.Context()).
		Where("active = ?", true).
		Order("priority DESC, name ASC").
		Find(&sources).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	response := make([]feedSourceResponse, 0, len(sources))
	for _, source := range sources {
		response = append(response, feedSourceResponse{
			ID:         source.ID,
			Name:       source.Name,
			BaseURL:    source.BaseURL,
			SourceType: source.SourceType,
			FetchMode:  source.FetchMode,
			Priority:   source.Priority,
		})
	}

	c.JSON(http.StatusOK, gin.H{"sources": response})
}

func GetFeedPreferences(c *gin.Context) {
	uid, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	prefs, err := loadFeedPreferences(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, preferencePayloadFromSets(prefs))
}

func PutFeedPreferences(c *gin.Context) {
	uid, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var payload feedPreferencesPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	records := make([]models.UserFeedPreference, 0, len(payload.Topics)+len(payload.Tickers)+len(payload.Sources))
	for _, topic := range uniqueStrings(payload.Topics) {
		records = append(records, models.UserFeedPreference{UserID: uid, PrefType: "topic", Value: topic})
	}
	for _, ticker := range uniqueStrings(payload.Tickers) {
		records = append(records, models.UserFeedPreference{UserID: uid, PrefType: "ticker", Value: strings.ToUpper(ticker)})
	}
	for _, source := range uniqueStrings(payload.Sources) {
		records = append(records, models.UserFeedPreference{UserID: uid, PrefType: "source", Value: source})
	}

	tx := global.DB.WithContext(c.Request.Context()).Begin()
	if err := tx.Where("user_id = ?", uid).Delete(&models.UserFeedPreference{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if len(records) > 0 {
		if err := tx.Create(&records).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}
	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	invalidateFeedBoardCache(c.Request.Context())

	c.JSON(http.StatusOK, preferencePayloadFromSets(feedPreferenceSets{
		Topics:  setFromSlice(uniqueStrings(payload.Topics)),
		Tickers: setFromSlice(uniqueStrings(upperSlice(payload.Tickers))),
		Sources: setFromSlice(uniqueStrings(payload.Sources)),
	}))
}

func setFromSlice(values []string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		result[value] = struct{}{}
	}
	return result
}

func upperSlice(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		result = append(result, strings.ToUpper(strings.TrimSpace(value)))
	}
	return result
}

func GetFeed(c *gin.Context) {
	uid, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	tab := strings.TrimSpace(c.DefaultQuery("tab", "for-you"))
	topic := strings.TrimSpace(c.Query("topic"))
	ticker := strings.ToUpper(strings.TrimSpace(c.Query("ticker")))
	sourceFilter := strings.TrimSpace(c.Query("source"))
	cursor := strings.TrimSpace(c.Query("cursor"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "24"))
	if limit <= 0 || limit > 48 {
		limit = 24
	}

	cacheKey := feedCacheKey(uid, tab, topic, ticker, sourceFilter, cursor, limit)
	if cached, err := global.RedisDB.Get(c.Request.Context(), cacheKey).Result(); err == nil {
		var response feedBoardResponse
		if json.Unmarshal([]byte(cached), &response) == nil {
			c.JSON(http.StatusOK, response)
			return
		}
	}

	prefs, err := loadFeedPreferences(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	response, err := queryFeedBoard(c.Request.Context(), uid, prefs, tab, topic, ticker, sourceFilter, cursor, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if payload, err := json.Marshal(response); err == nil {
		_ = global.RedisDB.Set(c.Request.Context(), cacheKey, payload, feedBoardCacheTTL).Err()
	}
	c.JSON(http.StatusOK, response)
}

func queryFeedBoard(
	ctx context.Context,
	userID uint,
	prefs feedPreferenceSets,
	tab, topic, ticker, sourceFilter, cursor string,
	limit int,
) (feedBoardResponse, error) {
	base := global.DB.WithContext(ctx).
		Model(&models.FeedItem{}).
		Preload("Source").
		Where("feed_items.deleted_at IS NULL")
	if sourceFilter != "" {
		if parsed, err := strconv.Atoi(sourceFilter); err == nil {
			base = base.Where("feed_items.source_id = ?", parsed)
		} else {
			base = base.Joins("JOIN feed_sources ON feed_sources.id = feed_items.source_id").
				Where("feed_sources.name = ?", sourceFilter)
		}
	}
	if topic != "" {
		base = base.Where("primary_topic = ?", topic)
	}
	if ticker != "" {
		base = base.Where("primary_ticker = ?", ticker)
	}
	switch tab {
	case "ai":
		base = base.Where("primary_topic = ?", "AI")
	case "macro":
		base = base.Where("primary_topic = ?", "Macro")
	case "earnings":
		base = base.Where("content_type = ? OR primary_topic = ?", "earnings", "Earnings")
	case "stocks":
		base = base.Where("primary_ticker <> '' OR primary_topic = ?", "Stocks")
	case "saved":
		base = base.Joins("JOIN user_feed_saves ON user_feed_saves.item_id = feed_items.id AND user_feed_saves.user_id = ?", userID)
	}

	offset := 0
	if cursor != "" {
		if parsed, err := strconv.Atoi(cursor); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	candidateLimit := feedCandidateWindow
	if limit > candidateLimit {
		candidateLimit = limit
	}
	var items []models.FeedItem
	if err := base.
		Order("COALESCE(feed_items.published_at, feed_items.created_at) DESC, feed_items.id DESC").
		Limit(candidateLimit).
		Find(&items).Error; err != nil {
		return feedBoardResponse{}, err
	}
	if len(items) == 0 {
		return feedBoardResponse{Items: []feedBoardItemResponse{}}, nil
	}

	itemIDs := make([]uint, 0, len(items))
	for _, item := range items {
		itemIDs = append(itemIDs, item.ID)
	}

	tagsByItem, _ := loadFeedTags(ctx, itemIDs)
	likeCounts, likedSet, _ := loadFeedLikeStats(ctx, userID, itemIDs)
	saveCounts, savedSet, _ := loadFeedSaveStats(ctx, userID, itemIDs)

	type scored struct {
		item           models.FeedItem
		score          float64
		preferenceHit  bool
		topics         []string
		tickers        []string
		likeCount      int64
		saveCount      int64
		liked          bool
		saved          bool
		sourcePriority int
	}

	scoredItems := make([]scored, 0, len(items))
	for _, item := range items {
		tagInfo := tagsByItem[item.ID]
		preferenceHit := matchesFeedPreference(prefs, item, tagInfo.topics, tagInfo.tickers)
		if tab == "following" && !preferenceHit {
			continue
		}
		score := computeFeedScore(item, item.Source.Priority, likeCounts[item.ID], saveCounts[item.ID], preferenceHit, tab)
		scoredItems = append(scoredItems, scored{
			item:           item,
			score:          score,
			preferenceHit:  preferenceHit,
			topics:         tagInfo.topics,
			tickers:        tagInfo.tickers,
			likeCount:      likeCounts[item.ID],
			saveCount:      saveCounts[item.ID],
			liked:          likedSet[item.ID],
			saved:          savedSet[item.ID],
			sourcePriority: item.Source.Priority,
		})
	}

	sort.SliceStable(scoredItems, func(i, j int) bool {
		if scoredItems[i].score == scoredItems[j].score {
			return scoredItems[i].item.ID > scoredItems[j].item.ID
		}
		return scoredItems[i].score > scoredItems[j].score
	})

	if offset >= len(scoredItems) {
		return feedBoardResponse{Items: []feedBoardItemResponse{}}, nil
	}

	end := offset + limit
	if end > len(scoredItems) {
		end = len(scoredItems)
	}
	pageItems := scoredItems[offset:end]

	response := make([]feedBoardItemResponse, 0, len(pageItems))
	for _, entry := range pageItems {
		publishedAt := entry.item.PublishedAt
		response = append(response, feedBoardItemResponse{
			ID:             entry.item.ID,
			Title:          entry.item.Title,
			Excerpt:        entry.item.Excerpt,
			CanonicalURL:   entry.item.CanonicalURL,
			CoverImageURL:  entry.item.CoverImageURL,
			PublishedAt:    publishedAt,
			SourceID:       entry.item.SourceID,
			SourceName:     entry.item.Source.Name,
			SourceType:     entry.item.Source.SourceType,
			PrimaryTopic:   entry.item.PrimaryTopic,
			PrimaryTicker:  entry.item.PrimaryTicker,
			ContentType:    entry.item.ContentType,
			Topics:         entry.topics,
			Tickers:        entry.tickers,
			LikeCount:      entry.likeCount,
			SaveCount:      entry.saveCount,
			Liked:          entry.liked,
			Saved:          entry.saved,
			PreferenceHit:  entry.preferenceHit,
			SourcePriority: entry.sourcePriority,
		})
	}

	nextCursor := ""
	if end < len(scoredItems) {
		nextCursor = strconv.Itoa(end)
	}

	return feedBoardResponse{Items: response, NextCursor: nextCursor}, nil
}

type feedTagGroup struct {
	topics  []string
	tickers []string
}

func loadFeedTags(ctx context.Context, itemIDs []uint) (map[uint]feedTagGroup, error) {
	result := make(map[uint]feedTagGroup, len(itemIDs))
	var tags []models.FeedTag
	if err := global.DB.WithContext(ctx).Where("item_id IN ?", itemIDs).Find(&tags).Error; err != nil {
		return result, err
	}
	for _, tag := range tags {
		entry := result[tag.ItemID]
		switch tag.Kind {
		case "topic":
			entry.topics = append(entry.topics, tag.Value)
		case "ticker":
			entry.tickers = append(entry.tickers, tag.Value)
		}
		result[tag.ItemID] = entry
	}
	for itemID, entry := range result {
		entry.topics = uniqueStrings(entry.topics)
		entry.tickers = uniqueStrings(entry.tickers)
		result[itemID] = entry
	}
	return result, nil
}

func loadFeedLikeStats(ctx context.Context, userID uint, itemIDs []uint) (map[uint]int64, map[uint]bool, error) {
	counts := make(map[uint]int64, len(itemIDs))
	liked := make(map[uint]bool, len(itemIDs))
	type countRow struct {
		ItemID uint
		Count  int64
	}
	var countRows []countRow
	if err := global.DB.WithContext(ctx).
		Model(&models.UserFeedLike{}).
		Select("item_id, COUNT(*) AS count").
		Where("item_id IN ?", itemIDs).
		Group("item_id").
		Scan(&countRows).Error; err != nil {
		return counts, liked, err
	}
	for _, row := range countRows {
		counts[row.ItemID] = row.Count
	}
	var userLikes []models.UserFeedLike
	if err := global.DB.WithContext(ctx).
		Where("user_id = ? AND item_id IN ?", userID, itemIDs).
		Find(&userLikes).Error; err != nil {
		return counts, liked, err
	}
	for _, like := range userLikes {
		liked[like.ItemID] = true
	}
	return counts, liked, nil
}

func loadFeedSaveStats(ctx context.Context, userID uint, itemIDs []uint) (map[uint]int64, map[uint]bool, error) {
	counts := make(map[uint]int64, len(itemIDs))
	saved := make(map[uint]bool, len(itemIDs))
	type countRow struct {
		ItemID uint
		Count  int64
	}
	var countRows []countRow
	if err := global.DB.WithContext(ctx).
		Model(&models.UserFeedSave{}).
		Select("item_id, COUNT(*) AS count").
		Where("item_id IN ?", itemIDs).
		Group("item_id").
		Scan(&countRows).Error; err != nil {
		return counts, saved, err
	}
	for _, row := range countRows {
		counts[row.ItemID] = row.Count
	}
	var userSaves []models.UserFeedSave
	if err := global.DB.WithContext(ctx).
		Where("user_id = ? AND item_id IN ?", userID, itemIDs).
		Find(&userSaves).Error; err != nil {
		return counts, saved, err
	}
	for _, save := range userSaves {
		saved[save.ItemID] = true
	}
	return counts, saved, nil
}

func matchesFeedPreference(prefs feedPreferenceSets, item models.FeedItem, topics, tickers []string) bool {
	if _, ok := prefs.Sources[item.Source.Name]; ok {
		return true
	}
	if item.PrimaryTopic != "" {
		if _, ok := prefs.Topics[item.PrimaryTopic]; ok {
			return true
		}
	}
	if item.PrimaryTicker != "" {
		if _, ok := prefs.Tickers[item.PrimaryTicker]; ok {
			return true
		}
	}
	for _, topic := range topics {
		if _, ok := prefs.Topics[topic]; ok {
			return true
		}
	}
	for _, ticker := range tickers {
		if _, ok := prefs.Tickers[ticker]; ok {
			return true
		}
	}
	return false
}

func computeFeedScore(item models.FeedItem, sourcePriority int, likeCount, saveCount int64, preferenceHit bool, tab string) float64 {
	publishedAt := item.CreatedAt
	if item.PublishedAt != nil {
		publishedAt = *item.PublishedAt
	}
	ageHours := time.Since(publishedAt).Hours()
	if ageHours < 0 {
		ageHours = 0
	}

	freshness := 120 - minFloat(ageHours*2.5, 100)
	engagement := float64(likeCount)*2.2 + float64(saveCount)*4.0
	preferenceBoost := 0.0
	if preferenceHit {
		preferenceBoost = 32
	}
	tabBoost := 0.0
	switch tab {
	case "following":
		tabBoost = 24
	case "saved":
		tabBoost = 18
	case "ai", "macro", "earnings", "stocks":
		tabBoost = 8
	}

	return freshness + float64(sourcePriority)*0.6 + engagement + preferenceBoost + tabBoost
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func ToggleFeedLike(c *gin.Context) {
	toggleFeedUserAction(c, &models.UserFeedLike{}, "liked")
}

func ToggleFeedSave(c *gin.Context) {
	toggleFeedUserAction(c, &models.UserFeedSave{}, "saved")
}

func toggleFeedUserAction(c *gin.Context, model interface{}, field string) {
	uid, ok := currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	itemID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || itemID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid item id"})
		return
	}

	var item models.FeedItem
	if err := global.DB.WithContext(c.Request.Context()).First(&item, uint(itemID)).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "feed item not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	tx := global.DB.WithContext(c.Request.Context()).Begin()
	var existed bool
	switch typed := model.(type) {
	case *models.UserFeedLike:
		var existing models.UserFeedLike
		err := tx.Where("user_id = ? AND item_id = ?", uid, uint(itemID)).First(&existing).Error
		if err == nil {
			existed = true
			if err := tx.Delete(&existing).Error; err != nil {
				tx.Rollback()
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		} else if errors.Is(err, gorm.ErrRecordNotFound) {
			record := models.UserFeedLike{UserID: uid, ItemID: uint(itemID)}
			if err := tx.Create(&record).Error; err != nil {
				tx.Rollback()
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		} else {
			_ = typed
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	case *models.UserFeedSave:
		var existing models.UserFeedSave
		err := tx.Where("user_id = ? AND item_id = ?", uid, uint(itemID)).First(&existing).Error
		if err == nil {
			existed = true
			if err := tx.Delete(&existing).Error; err != nil {
				tx.Rollback()
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		} else if errors.Is(err, gorm.ErrRecordNotFound) {
			record := models.UserFeedSave{UserID: uid, ItemID: uint(itemID)}
			if err := tx.Create(&record).Error; err != nil {
				tx.Rollback()
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		} else {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	invalidateFeedBoardCache(c.Request.Context())

	var count int64
	switch model.(type) {
	case *models.UserFeedLike:
		_ = global.DB.WithContext(c.Request.Context()).Model(&models.UserFeedLike{}).Where("item_id = ?", uint(itemID)).Count(&count).Error
	case *models.UserFeedSave:
		_ = global.DB.WithContext(c.Request.Context()).Model(&models.UserFeedSave{}).Where("item_id = ?", uint(itemID)).Count(&count).Error
	}

	c.JSON(http.StatusOK, gin.H{
		"id":    item.ID,
		field:   !existed,
		"count": count,
	})
}
