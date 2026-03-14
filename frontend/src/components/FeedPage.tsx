import { useState, useEffect } from 'react'
import './FeedPage.css'

export const VITE_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'
const TOKEN_STORAGE_KEY = 'fingoat_token'

const getAuthHeader = () => {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY)
  if (!token) {
    return ''
  }
  return token.startsWith('Bearer ') ? token : `Bearer ${token}`
}

export interface Article {
  id: number
  title: string
  source: string
  preview: string
  content: string
  link?: string
  publishedAt?: string
  createdAt: string
}

type ArticleApiRecord = Partial<Article> & {
  ID?: number
  Title?: string
  Source?: string
  Preview?: string
  Content?: string
  Link?: string
  PublishedAt?: string
  CreatedAt?: string
}

interface FeedPageProps {
  onSessionExpired: (msg?: string) => void
}

export function FeedPage({ onSessionExpired }: FeedPageProps) {
  const [articles, setArticles] = useState<Article[]>([])
  const [articlesLoading, setArticlesLoading] = useState(false)
  const [articlesError, setArticlesError] = useState('')
  const [expandedArticles, setExpandedArticles] = useState<Record<number, boolean>>({})
  const [articleLikes, setArticleLikes] = useState<Record<number, number>>({})
  const [likingArticle, setLikingArticle] = useState<Record<number, boolean>>({})

  const fetchArticleLikes = async (articleId: number, token: string) => {
    try {
      const resp = await fetch(`${VITE_API_URL}/api/articles/${articleId}/like`, {
        headers: { Authorization: token },
      })
      if (resp.ok) {
        const data = await resp.json()
        setArticleLikes((prev) => ({ ...prev, [articleId]: data.likes }))
      }
    } catch (err) {
      console.error(`Failed to fetch likes for article ${articleId}`, err)
    }
  }

  const normalizeArticle = (record: ArticleApiRecord): Article => ({
    id: record.id ?? record.ID ?? 0,
    title: record.title ?? record.Title ?? '',
    source: record.source ?? record.Source ?? '',
    preview: record.preview ?? record.Preview ?? '',
    content: record.content ?? record.Content ?? '',
    link: record.link ?? record.Link,
    publishedAt: record.publishedAt ?? record.PublishedAt,
    createdAt: record.createdAt ?? record.CreatedAt ?? '',
  })

  const fetchArticles = async (options?: { refresh?: boolean }) => {
    if (articlesLoading) return
    const token = getAuthHeader()
    if (!token) return

    setArticlesLoading(true)
    setArticlesError('')
    try {
      const url = new URL(`${VITE_API_URL}/api/articles`)
      if (options?.refresh) {
        url.searchParams.set('refresh', 'true')
      }

      const resp = await fetch(url.toString(), {
        headers: { Authorization: token },
      })

      if (resp.status === 401) {
        onSessionExpired()
        return
      }

      const data = await resp.json()
      if (resp.ok) {
        const normalized = Array.isArray(data)
          ? data.map((article) => normalizeArticle(article as ArticleApiRecord))
          : []
        setArticles(normalized)
        normalized.forEach((article) => {
          fetchArticleLikes(article.id, token)
        })
      } else {
        setArticlesError(data.error || 'Failed to fetch articles')
      }
    } catch (err) {
      console.error(err)
      setArticlesError('Network error checking articles.')
    } finally {
      setArticlesLoading(false)
    }
  }

  const handleLikeArticle = async (articleId: number) => {
    const token = getAuthHeader()
    if (!token) return

    setLikingArticle((prev) => ({ ...prev, [articleId]: true }))
    try {
      const resp = await fetch(`${VITE_API_URL}/api/articles/${articleId}/like`, {
        method: 'POST',
        headers: { Authorization: token },
      })
      if (resp.status === 401) {
        onSessionExpired()
        return
      }
      if (resp.ok) {
        const data = await resp.json()
        setArticleLikes((prev) => ({ ...prev, [articleId]: data.likes }))
      }
    } catch (err) {
      console.error('Like error:', err)
    } finally {
      setLikingArticle((prev) => ({ ...prev, [articleId]: false }))
    }
  }

  const toggleArticleBody = (id: number) => {
    setExpandedArticles((prev) => ({
      ...prev,
      [id]: !prev[id],
    }))
  }

  const formatTimestamp = (ts: string) => {
    return new Date(ts).toLocaleString()
  }

  useEffect(() => {
    fetchArticles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="feed-page">
      <header className="feed-header">
        <h1>Market Intelligence</h1>
        <div className="feed-actions">
          <button
            type="button"
            className="action-btn outline"
            onClick={() => fetchArticles({ refresh: true })}
            disabled={articlesLoading}
          >
            {articlesLoading ? '↻ Refreshing...' : '↻ Refresh Feed'}
          </button>
        </div>
      </header>

      {articlesError && <div className="feed-error">{articlesError}</div>}

      {!articlesLoading && !articlesError && articles.length === 0 && (
        <div className="feed-status">No articles found in the intelligence stream.</div>
      )}

      <div className="feed-masonry">
        {articles.map((article) => {
          const expanded = !!expandedArticles[article.id]
          const likes = articleLikes[article.id] ?? 0
          const isLiking = !!likingArticle[article.id]

          return (
            <article key={article.id} className="feed-card">
              <div className="feed-card-content">
                <div className="feed-card-meta">
                  <span>{article.source || 'SYSTEM'}</span>
                  <span>•</span>
                  <span>{formatTimestamp(article.publishedAt || article.createdAt)}</span>
                </div>
                
                <h3 className="feed-card-title">{article.title}</h3>
                
                <p className="feed-card-preview">{article.preview}</p>
                
                {expanded && <div className="feed-card-full">{article.content}</div>}
              </div>

              <div className="feed-card-footer">
                <div className="feed-interaction">
                  <button
                    type="button"
                    className="feed-btn"
                    onClick={() => toggleArticleBody(article.id)}
                  >
                    {expanded ? '↑ Less' : '↓ More'}
                  </button>
                  <button
                    type="button"
                    className={`feed-btn ${likes > 0 ? 'active' : ''}`}
                    onClick={() => handleLikeArticle(article.id)}
                    disabled={isLiking}
                  >
                    ♥ {likes}
                  </button>
                </div>
                {article.link && (
                  <a
                    className="feed-card-link"
                    href={article.link}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Visit Source ↗
                  </a>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
