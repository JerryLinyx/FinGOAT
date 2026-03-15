import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AnalysisTask } from '../services/tradingService'
import { AGENT_STAGES, buildStageProgress, firstStageWithContent, type AgentStageKey } from './agentStages'
import { AgentFlowGraph } from './AgentFlowGraph'

interface AgentResultsModuleProps {
  task?: AnalysisTask | null
  stageTokens?: Map<string, string>
}

const formatDuration = (seconds?: number) => {
  if (seconds === undefined) return ''
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const remaining = Math.floor(seconds % 60)
  return `${minutes}m ${remaining}s`
}

// ── Markdown extraction from structured content ──────────────────────────────

const PRIORITY_KEYS = [
  'judge_decision',
  'current_response',
  'summary',
  'recommendation',
  'signal',
  'decision',
  'action',
  'reasoning',
  'explanation',
  'rationale',
  'analysis',
]

function extractMarkdownText(content: unknown): string {
  if (content === null || content === undefined) return ''
  if (typeof content === 'string') return content

  if (typeof content === 'object' && !Array.isArray(content)) {
    const obj = content as Record<string, unknown>
    for (const key of PRIORITY_KEYS) {
      if (key in obj && obj[key] !== null && obj[key] !== undefined) {
        const val = obj[key]
        if (typeof val === 'string' && val.trim()) return val
      }
    }
    // Fallback: JSON
    try {
      return '```json\n' + JSON.stringify(obj, null, 2) + '\n```'
    } catch {
      return String(content)
    }
  }

  if (Array.isArray(content)) {
    return content.map(extractMarkdownText).filter(Boolean).join('\n\n')
  }

  try {
    return JSON.stringify(content, null, 2)
  } catch {
    return String(content)
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export function AgentResultsModule({ task, stageTokens }: AgentResultsModuleProps) {
  const stages = useMemo(() => buildStageProgress(task), [task])
  const [selectedStage, setSelectedStage] = useState<AgentStageKey | null>(null)
  const [viewMode, setViewMode] = useState<'stages' | 'graph'>('stages')

  useEffect(() => {
    if (!selectedStage) {
      setSelectedStage(firstStageWithContent(stages) ?? AGENT_STAGES[0].key)
      return
    }

    const existing = stages.find((stage) => stage.key === selectedStage)
    if (!existing) {
      setSelectedStage(firstStageWithContent(stages) ?? AGENT_STAGES[0].key)
    }
  }, [selectedStage, stages])

  const activeStage = stages.find((stage) => stage.key === selectedStage) ?? stages[0]
  if (!task || !activeStage) return null

  const completedCount = stages.filter((s) => s.status === 'completed').length
  const processingStage = stages.find((s) => s.status === 'processing')
  const totalCount = stages.length
  const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0

  const detailMeta = [activeStage.backend, activeStage.durationSeconds !== undefined ? formatDuration(activeStage.durationSeconds) : null]
    .filter(Boolean)
    .join(' · ')

  // Determine what to show in the detail panel
  const liveTokenText = stageTokens?.get(activeStage.key) ?? ''
  const finalMarkdown = liveTokenText || extractMarkdownText(activeStage.content)
  const isStreaming = activeStage.status === 'processing' && liveTokenText.length > 0

  return (
    <div className="agent-results-module">
      {/* Progress bar — spans full width */}
      <div className="agent-progress-bar-wrap" style={{ gridColumn: '1 / -1' }}>
        <div className="agent-progress-bar-track">
          <div className="agent-progress-bar-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <span className="agent-progress-label">
          {completedCount}/{totalCount}
          {processingStage ? ` · ${processingStage.icon} ${processingStage.label}` : ''}
        </span>
      </div>

      {/* Tab bar — spans full width */}
      <div className="arm-tabs" style={{ gridColumn: '1 / -1' }}>
        <button
          type="button"
          className={viewMode === 'stages' ? 'arm-tab--active' : ''}
          onClick={() => setViewMode('stages')}
        >
          📋 Stage List
        </button>
        <button
          type="button"
          className={viewMode === 'graph' ? 'arm-tab--active' : ''}
          onClick={() => setViewMode('graph')}
        >
          🔀 Flow Graph
        </button>
      </div>

      {/* ── Stage List view ── */}
      {viewMode === 'stages' && (
        <>
          <div className="agent-results-module__stages">
            {stages.map((stage) => (
              <button
                key={stage.key}
                type="button"
                className={[
                  'agent-stage-card',
                  `agent-stage-card--${stage.status}`,
                  stage.key === activeStage.key ? 'agent-stage-card--active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setSelectedStage(stage.key)}
              >
                <div className="agent-stage-card__header">
                  <span className="agent-stage-card__label">
                    <span className="agent-stage-card__icon">{stage.icon}</span>
                    {stage.label}
                  </span>
                  <span className={`agent-stage-card__badge agent-stage-card__badge--${stage.status}`}>
                    {stage.status.toUpperCase()}
                  </span>
                </div>
                {stage.backend && (
                  <div className="agent-stage-card__duration">{stage.backend === 'openclaw' ? 'OpenClaw' : 'Default'}</div>
                )}
                {stage.durationSeconds !== undefined && (
                  <div className="agent-stage-card__duration">{formatDuration(stage.durationSeconds)}</div>
                )}
                <div className="agent-stage-card__summary">
                  {/* Show live token snippet if this stage is streaming */}
                  {stage.key === activeStage.key && isStreaming
                    ? (stageTokens?.get(stage.key) ?? '').slice(0, 80) + '...'
                    : stage.summary ?? (stage.status === 'processing' ? 'Stage in progress...' : 'Waiting for output.')}
                </div>
              </button>
            ))}
          </div>

          <div className="agent-stage-detail">
            <div className="agent-stage-detail__header">
              <h4>
                <span className="agent-stage-detail__icon">{activeStage.icon}</span>
                {activeStage.label}
              </h4>
              {detailMeta && <span className="agent-stage-detail__duration">{detailMeta}</span>}
            </div>
            <div className="agent-stage-detail__content">
              {finalMarkdown ? (
                <div className="stage-markdown-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{finalMarkdown}</ReactMarkdown>
                  {isStreaming && <span className="streaming-cursor">▍</span>}
                </div>
              ) : (
                <p className="stage-content-empty">No stage output yet.</p>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Flow Graph view ── */}
      {viewMode === 'graph' && (
        <div style={{ gridColumn: '1 / -1' }}>
          <AgentFlowGraph
            stages={stages}
            selectedKey={selectedStage}
            onSelectStage={(key) => setSelectedStage(key)}
          />
          {selectedStage && (
            <div className="flow-detail-panel">
              <div className="agent-stage-detail__header">
                <h4>
                  <span className="agent-stage-detail__icon">{activeStage.icon}</span>
                  {activeStage.label}
                </h4>
                {detailMeta && <span className="agent-stage-detail__duration">{detailMeta}</span>}
              </div>
              <div className="agent-stage-detail__content">
                {finalMarkdown ? (
                  <div className="stage-markdown-content">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{finalMarkdown}</ReactMarkdown>
                    {isStreaming && <span className="streaming-cursor">▍</span>}
                  </div>
                ) : (
                  <p className="stage-content-empty">No stage output yet.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
