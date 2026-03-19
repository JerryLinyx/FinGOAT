import { useEffect, useMemo, useRef, useState } from 'react'
import './FeedPage.css'
import {
  feedService,
  type FeedItem,
  type FeedPreferences,
  type FeedSource,
  type FeedTab,
} from '../services/feedService'

interface FeedPageProps {
  onSessionExpired: (msg?: string) => void
}

const BOARD_TABS: Array<{ key: FeedTab; label: string; eyebrow: string }> = [
  { key: 'for-you', label: 'For You', eyebrow: 'Personalized board' },
  { key: 'following', label: 'Following', eyebrow: 'Your watchlist' },
  { key: 'ai', label: 'AI', eyebrow: 'Model and infra pulse' },
  { key: 'macro', label: 'Macro', eyebrow: 'Policy and rates' },
  { key: 'earnings', label: 'Earnings', eyebrow: 'Guidance and quarters' },
  { key: 'stocks', label: 'Stocks', eyebrow: 'Signals with tickers' },
  { key: 'saved', label: 'Saved', eyebrow: 'Your library' },
]

const EMPTY_PREFERENCES: FeedPreferences = {
  topics: [],
  tickers: [],
  sources: [],
}

function parseCommaSeparated(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

function formatDate(value?: string) {
  if (!value) return 'Freshly surfaced'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Freshly surfaced'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed)
}

function FeedCardSkeleton() {
  return (
    <article className="signal-card signal-card--skeleton" aria-hidden="true">
      <div className="signal-card__cover signal-card__cover--skeleton" />
      <div className="signal-card__body">
        <div className="signal-card__line signal-card__line--short" />
        <div className="signal-card__line" />
        <div className="signal-card__line signal-card__line--medium" />
      </div>
    </article>
  )
}

function coverFallbackLabel(item: FeedItem) {
  if (item.primary_ticker) return item.primary_ticker
  if (item.primary_topic) return item.primary_topic.slice(0, 6).toUpperCase()
  return item.source_name.slice(0, 2).toUpperCase()
}

export function FeedPage({ onSessionExpired }: FeedPageProps) {
  const [activeTab, setActiveTab] = useState<FeedTab>('for-you')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [items, setItems] = useState<FeedItem[]>([])
  const [nextCursor, setNextCursor] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [sources, setSources] = useState<FeedSource[]>([])
  const [preferences, setPreferences] = useState<FeedPreferences>(EMPTY_PREFERENCES)
  const [draftTopics, setDraftTopics] = useState('')
  const [draftTickers, setDraftTickers] = useState('')
  const [draftSources, setDraftSources] = useState<string[]>([])
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [preferencesSaving, setPreferencesSaving] = useState(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const selectedTabMeta = useMemo(
    () => BOARD_TABS.find((tab) => tab.key === activeTab) ?? BOARD_TABS[0],
    [activeTab],
  )

  const handleError = (err: unknown, fallback: string) => {
    const message = err instanceof Error ? err.message : fallback
    const status =
      typeof err === 'object' && err !== null && 'status' in err
        ? Number((err as { status?: unknown }).status)
        : undefined
    setError(message)
    if (status === 401 || message.toLowerCase().includes('unauthorized') || message.includes('401')) {
      onSessionExpired(message)
    }
  }

  const syncPreferencesDraft = (value: FeedPreferences) => {
    setPreferences(value)
    setDraftTopics(value.topics.join(', '))
    setDraftTickers(value.tickers.join(', '))
    setDraftSources(value.sources)
  }

  const loadBoard = async (reset = false) => {
    const next = reset ? '' : nextCursor
    if (reset) {
      setLoading(true)
      setError('')
    } else {
      setLoadingMore(true)
    }

    try {
      const response = await feedService.getBoard({
        tab: activeTab,
        source: sourceFilter,
        cursor: next || undefined,
        limit: 24,
      })
      setItems((prev) => {
        if (reset) return response.items
        const seen = new Set(prev.map((item) => item.id))
        const merged = [...prev]
        response.items.forEach((item) => {
          if (!seen.has(item.id)) {
            merged.push(item)
          }
        })
        return merged
      })
      setNextCursor(response.next_cursor ?? '')
    } catch (err) {
      handleError(err, 'Failed to load signals board')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    Promise.all([feedService.getSources(), feedService.getPreferences()])
      .then(([loadedSources, loadedPreferences]) => {
        if (cancelled) return
        setSources(loadedSources)
        syncPreferencesDraft(loadedPreferences)
      })
      .catch((err) => {
        if (!cancelled) {
          handleError(err, 'Failed to load feed settings')
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setItems([])
    setNextCursor('')
    void loadBoard(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, sourceFilter])

  useEffect(() => {
    if (!nextCursor || loadingMore || loading) return undefined
    const target = sentinelRef.current
    if (!target) return undefined

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void loadBoard(false)
      }
    }, { rootMargin: '400px' })

    observer.observe(target)
    return () => observer.disconnect()
  }, [nextCursor, loadingMore, loading])

  const handleToggleLike = async (itemId: number) => {
    setItems((prev) => prev.map((item) => (
      item.id === itemId
        ? {
            ...item,
            liked: !item.liked,
            like_count: item.liked ? Math.max(0, item.like_count - 1) : item.like_count + 1,
          }
        : item
    )))

    try {
      const response = await feedService.toggleLike(itemId)
      setItems((prev) => prev.map((item) => (
        item.id === itemId
          ? { ...item, liked: response.liked, like_count: response.count }
          : item
      )))
    } catch (err) {
      handleError(err, 'Failed to update like')
      void loadBoard(true)
    }
  }

  const handleToggleSave = async (itemId: number) => {
    setItems((prev) => prev.map((item) => (
      item.id === itemId
        ? {
            ...item,
            saved: !item.saved,
            save_count: item.saved ? Math.max(0, item.save_count - 1) : item.save_count + 1,
          }
        : item
    )))

    try {
      const response = await feedService.toggleSave(itemId)
      setItems((prev) => prev.map((item) => (
        item.id === itemId
          ? { ...item, saved: response.saved, save_count: response.count }
          : item
      )))
    } catch (err) {
      handleError(err, 'Failed to update save')
      void loadBoard(true)
    }
  }

  const handleSavePreferences = async () => {
    setPreferencesSaving(true)
    setError('')
    try {
      const payload: FeedPreferences = {
        topics: parseCommaSeparated(draftTopics),
        tickers: parseCommaSeparated(draftTickers).map((value) => value.toUpperCase()),
        sources: draftSources,
      }
      const response = await feedService.savePreferences(payload)
      syncPreferencesDraft(response)
      setPreferencesOpen(false)
      setItems([])
      setNextCursor('')
      await loadBoard(true)
    } catch (err) {
      handleError(err, 'Failed to save feed preferences')
    } finally {
      setPreferencesSaving(false)
    }
  }

  const heroStats = useMemo(() => {
    const likes = items.reduce((sum, item) => sum + item.like_count, 0)
    const saves = items.reduce((sum, item) => sum + item.save_count, 0)
    const preferenceHits = items.filter((item) => item.preference_hit).length
    return { likes, saves, preferenceHits }
  }, [items])

  return (
    <div className="signals-board">
      <section className="signals-hero">
        <div className="signals-hero__copy">
          <span className="signals-hero__eyebrow">{selectedTabMeta.eyebrow}</span>
          <h1>Signals Board</h1>
          <p>
            Discover high-signal posts from public research, AI, macro, and market sources without
            getting trapped in a plain RSS wall.
          </p>
        </div>
        <div className="signals-hero__metrics">
          <div className="signals-metric">
            <strong>{items.length}</strong>
            <span>Visible cards</span>
          </div>
          <div className="signals-metric">
            <strong>{heroStats.preferenceHits}</strong>
            <span>Matched to you</span>
          </div>
          <div className="signals-metric">
            <strong>{heroStats.likes + heroStats.saves}</strong>
            <span>Board interactions</span>
          </div>
        </div>
      </section>

      <section className="signals-toolbar">
        <div className="signals-tabs" role="tablist" aria-label="Signals board tabs">
          {BOARD_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              className={`signals-tab ${activeTab === tab.key ? 'signals-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="signals-toolbar__actions">
          <label className="signals-filter">
            <span>Source</span>
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
              <option value="all">All sources</option>
              {sources.map((source) => (
                <option key={source.id} value={source.name}>
                  {source.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="signals-settings-btn"
            onClick={() => setPreferencesOpen((value) => !value)}
          >
            Tune Feed
          </button>
        </div>
      </section>

      <section className={`signals-preferences ${preferencesOpen ? 'signals-preferences--open' : ''}`}>
        <div className="signals-preferences__header">
          <div>
            <p className="signals-preferences__eyebrow">Follow targets</p>
            <h2>Personalize your board</h2>
          </div>
          <button type="button" className="signals-preferences__close" onClick={() => setPreferencesOpen(false)}>
            Close
          </button>
        </div>

        <div className="signals-preferences__grid">
          <label className="signals-input">
            <span>Topics</span>
            <input
              type="text"
              value={draftTopics}
              onChange={(event) => setDraftTopics(event.target.value)}
              placeholder="AI, Macro, Earnings"
            />
          </label>

          <label className="signals-input">
            <span>Tickers</span>
            <input
              type="text"
              value={draftTickers}
              onChange={(event) => setDraftTickers(event.target.value)}
              placeholder="NVDA, AAPL, TSLA"
            />
          </label>
        </div>

        <div className="signals-source-picker">
          <span>Preferred sources</span>
          <div className="signals-source-picker__options">
            {sources.map((source) => {
              const selected = draftSources.includes(source.name)
              return (
                <button
                  key={source.id}
                  type="button"
                  className={`signals-source-pill ${selected ? 'signals-source-pill--active' : ''}`}
                  onClick={() => {
                    setDraftSources((prev) => (
                      selected
                        ? prev.filter((value) => value !== source.name)
                        : [...prev, source.name]
                    ))
                  }}
                >
                  {source.name}
                </button>
              )
            })}
          </div>
        </div>

        <div className="signals-preferences__footer">
          <div className="signals-preferences__summary">
            <span>{preferences.topics.length} topics</span>
            <span>{preferences.tickers.length} tickers</span>
            <span>{preferences.sources.length} sources</span>
          </div>
          <button
            type="button"
            className="signals-settings-btn signals-settings-btn--primary"
            disabled={preferencesSaving}
            onClick={() => void handleSavePreferences()}
          >
            {preferencesSaving ? 'Saving…' : 'Save preferences'}
          </button>
        </div>
      </section>

      {error && <div className="signals-error">{error}</div>}

      {loading ? (
        <div className="signals-grid">
          {Array.from({ length: 8 }).map((_, index) => (
            <FeedCardSkeleton key={index} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="signals-empty">
          <h2>No signals surfaced</h2>
          <p>Try another board tab or broaden the source filters.</p>
        </div>
      ) : (
        <div className="signals-grid">
          {items.map((item) => (
            <article
              key={item.id}
              className="signal-card"
              onClick={() => window.open(item.canonical_url, '_blank', 'noopener,noreferrer')}
            >
              <div className="signal-card__cover">
                {item.cover_image_url ? (
                  <img src={item.cover_image_url} alt="" loading="lazy" />
                ) : (
                  <div className={`signal-card__cover-fallback signal-card__cover-fallback--${item.source_type}`}>
                    <span>{coverFallbackLabel(item)}</span>
                  </div>
                )}
              </div>

              <div className="signal-card__body">
                <div className="signal-card__meta">
                  <span>{item.source_name}</span>
                  <span>•</span>
                  <span>{formatDate(item.published_at)}</span>
                </div>

                <h3>{item.title}</h3>
                <p>{item.excerpt}</p>

                <div className="signal-card__chips">
                  {item.preference_hit && <span className="signal-chip signal-chip--matched">Matched</span>}
                  {item.primary_topic && <span className="signal-chip">{item.primary_topic}</span>}
                  {item.primary_ticker && <span className="signal-chip signal-chip--ticker">${item.primary_ticker}</span>}
                  {(item.topics ?? []).slice(0, 2).map((topic) => (
                    topic !== item.primary_topic ? <span key={topic} className="signal-chip">{topic}</span> : null
                  ))}
                </div>
              </div>

              <div className="signal-card__footer">
                <div className="signal-card__actions">
                  <button
                    type="button"
                    className={`signal-action ${item.liked ? 'signal-action--active' : ''}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      void handleToggleLike(item.id)
                    }}
                  >
                    ♥ {item.like_count}
                  </button>
                  <button
                    type="button"
                    className={`signal-action ${item.saved ? 'signal-action--saved' : ''}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      void handleToggleSave(item.id)
                    }}
                  >
                    ✦ {item.save_count}
                  </button>
                </div>
                <span className="signal-card__cta">Open Source ↗</span>
              </div>
            </article>
          ))}
        </div>
      )}

      <div ref={sentinelRef} className="signals-sentinel">
        {loadingMore ? 'Loading more signals…' : nextCursor ? 'Scroll for more' : 'You have reached the end'}
      </div>
    </div>
  )
}
