type AnalystStageId = 'market' | 'social' | 'news' | 'fundamentals'

export interface AnalystLiveCardState {
  stageId: AnalystStageId
  label: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  nodeName: string
  text: string
  summary?: string | null
  currentTool?: string | null
  lastUpdatedAt?: string | null
  startedAt?: string | null
  completedAt?: string | null
  totalTokens?: number
  promptTokens?: number
  completionTokens?: number
  durationSeconds?: number
  llmCalls?: number
  error?: string | null
}

interface AnalystLiveGridProps {
  analysts: AnalystLiveCardState[]
}

const formatRelativeTime = (value?: string | null) => {
  if (!value) return 'N/A'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'N/A'
  const diffSec = Math.max(0, Math.round((Date.now() - parsed.getTime()) / 1000))
  if (diffSec < 5) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return parsed.toLocaleString()
}

const formatDuration = (seconds?: number) => {
  if (seconds === undefined || Number.isNaN(seconds)) return '—'
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const remain = Math.floor(seconds % 60)
  return `${minutes}m ${remain}s`
}

const formatTokens = (value?: number) => {
  if (value === undefined) return '—'
  if (value < 1000) return `${value}`
  return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
}

export function AnalystLiveGrid({ analysts }: AnalystLiveGridProps) {
  return (
    <section className="analyst-live-grid">
      <div className="analyst-live-grid__header">
        <div>
          <h4>Analyst Live Grid</h4>
          <p>Top-level analyst subprocesses stream their status, tokens, tools, and summaries here in real time.</p>
        </div>
      </div>

      <div className="analyst-live-grid__cards">
        {analysts.map((analyst) => {
          const snippet = analyst.text.trim()
            ? analyst.text.trim().slice(-180)
            : analyst.summary?.trim() ?? ''

          return (
            <article
              key={analyst.stageId}
              className={[
                'analyst-live-card',
                `analyst-live-card--${analyst.status}`,
              ].join(' ')}
            >
              <div className="analyst-live-card__top">
                <div>
                  <div className="analyst-live-card__label">{analyst.label}</div>
                  <div className="analyst-live-card__node">{analyst.nodeName}</div>
                </div>
                <span className={`analyst-live-card__status analyst-live-card__status--${analyst.status}`}>
                  {analyst.status}
                </span>
              </div>

              <div className="analyst-live-card__meta">
                <span>updated {formatRelativeTime(analyst.lastUpdatedAt)}</span>
                <span>{formatDuration(analyst.durationSeconds)}</span>
                <span>{formatTokens(analyst.totalTokens)} tok</span>
              </div>

              {(analyst.promptTokens !== undefined || analyst.completionTokens !== undefined) && (
                <div className="analyst-live-card__usage">
                  in {formatTokens(analyst.promptTokens)} · out {formatTokens(analyst.completionTokens)}
                  {analyst.llmCalls !== undefined ? ` · ${analyst.llmCalls} calls` : ''}
                </div>
              )}

              {analyst.currentTool && (
                <div className="analyst-live-card__tool">
                  tool · {analyst.currentTool}
                </div>
              )}

              <div className="analyst-live-card__body">
                {snippet ? snippet : 'Waiting for analyst output…'}
                {analyst.status === 'processing' && analyst.text ? <span className="streaming-cursor">▍</span> : null}
              </div>

              {analyst.summary && analyst.summary !== snippet && (
                <div className="analyst-live-card__summary">
                  {analyst.summary}
                </div>
              )}

              {analyst.error && (
                <div className="analyst-live-card__error">{analyst.error}</div>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
