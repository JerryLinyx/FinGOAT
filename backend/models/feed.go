package models

import (
	"time"

	"gorm.io/gorm"
)

// FeedSource configures a public site that can be fetched into the Signals Board.
type FeedSource struct {
	gorm.Model
	Name       string  `gorm:"type:varchar(160);not null"`
	BaseURL    string  `gorm:"type:text;not null"`
	SourceType string  `gorm:"type:varchar(40);not null;default:'news';index"`
	FetchMode  string  `gorm:"type:varchar(20);not null;default:'rss';index"`
	Active     bool    `gorm:"default:true;index"`
	Priority   int     `gorm:"default:0;index"`
	LastFetched *time.Time

	Items []FeedItem `gorm:"foreignKey:SourceID" json:"-"`
}

// FeedItem is the normalized content object rendered on the Signals Board.
type FeedItem struct {
	gorm.Model
	SourceID       uint       `gorm:"not null;index"`
	Title          string     `gorm:"type:text;not null"`
	Excerpt        string     `gorm:"type:text;not null"`
	CanonicalURL   string     `gorm:"type:text;not null;uniqueIndex"`
	CoverImageURL  string     `gorm:"type:text"`
	AuthorText     string     `gorm:"type:varchar(255)"`
	PublishedAt    *time.Time `gorm:"index"`
	Fingerprint    string     `gorm:"type:varchar(128);not null;uniqueIndex"`
	RawPayload     *string    `gorm:"type:jsonb"`
	PrimaryTopic   string     `gorm:"type:varchar(80);index"`
	PrimaryTicker  string     `gorm:"type:varchar(20);index"`
	ContentType    string     `gorm:"type:varchar(40);not null;default:'article';index"`

	Source FeedSource `gorm:"foreignKey:SourceID"`
	Tags   []FeedTag  `gorm:"foreignKey:ItemID"`
}

// FeedTag stores normalized tags for browsing and ranking.
type FeedTag struct {
	gorm.Model
	ItemID uint   `gorm:"not null;index:idx_feed_tag_item_kind_value,priority:1"`
	Kind   string `gorm:"type:varchar(30);not null;index:idx_feed_tag_item_kind_value,priority:2"` // topic / ticker / content_type
	Value  string `gorm:"type:varchar(120);not null;index:idx_feed_tag_item_kind_value,priority:3"`
}

// UserFeedPreference stores an explicit follow preference.
type UserFeedPreference struct {
	gorm.Model
	UserID   uint   `gorm:"not null;uniqueIndex:idx_user_feed_pref_unique,priority:1"`
	PrefType string `gorm:"type:varchar(20);not null;uniqueIndex:idx_user_feed_pref_unique,priority:2"` // topic / ticker / source
	Value    string `gorm:"type:varchar(120);not null;uniqueIndex:idx_user_feed_pref_unique,priority:3"`
}

// UserFeedSave stores a user's saved feed item.
type UserFeedSave struct {
	gorm.Model
	UserID uint `gorm:"not null;uniqueIndex:idx_user_feed_save_unique,priority:1"`
	ItemID uint `gorm:"not null;uniqueIndex:idx_user_feed_save_unique,priority:2"`
}

// UserFeedLike stores a user's liked feed item.
type UserFeedLike struct {
	gorm.Model
	UserID uint `gorm:"not null;uniqueIndex:idx_user_feed_like_unique,priority:1"`
	ItemID uint `gorm:"not null;uniqueIndex:idx_user_feed_like_unique,priority:2"`
}

func (FeedSource) TableName() string {
	return "feed_sources"
}

func (FeedItem) TableName() string {
	return "feed_items"
}

func (FeedTag) TableName() string {
	return "feed_tags"
}

func (UserFeedPreference) TableName() string {
	return "user_feed_preferences"
}

func (UserFeedSave) TableName() string {
	return "user_feed_saves"
}

func (UserFeedLike) TableName() string {
	return "user_feed_likes"
}
