import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AnalysisTask } from '../services/tradingService'
import {
  AGENT_STAGES, buildStageProgress, firstStageWithContent,
  type AgentStageKey, type ActivityEntry,
  type LiveStageResult, NODE_TO_STAGE,
} from './agentStages'
import { AgentFlowGraph } from './AgentFlowGraph'
import { AgentDashboard } from './AgentDashboard'

interface AgentResultsModuleProps {
  task?: AnalysisTask | null
  /** Tokens keyed by LangGraph node name e.g. "Bull Researcher" */
  nodeTokens?: Map<string, string>
  /** Set of currently-active LangGraph node names */
  activeNodes?: Set<string>
  /** Parsed stage_end stats, available immediately from SSE (no REST wait) */
  liveStageResults?: Map<string, LiveStageResult>
  activityLog?: ActivityEntry[]
}

const formatDuration = (seconds?: number) => {
  if (seconds === undefined) return ''
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const remaining = Math.floor(seconds % 60)
  return `${minutes}m ${remaining}s`
}

const formatTokens = (tokens?: number) => {
  if (tokens === undefined) return ''
  if (tokens < 1000) return `${tokens} tok`
  return `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k tok`
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

export function AgentResultsModule({ task, nodeTokens, activeNodes, liveStageResults, activityLog = [] }: AgentResultsModuleProps) {
  // Merge REST-polled stages with immediately-parsed stage_end stats
  const stages = useMemo(() => {
    const base = buildStageProgress(task)
    if (!liveStageResults || liveStageResults.size === 0) return base
    return base.map(stage => {
      const live = liveStageResults.get(stage.key)
      if (!live) return stage
      return {
        ...stage,
        // Override stats only, NOT status (status comes from canonical REST data)
        durationSeconds:  live.durationSeconds  ?? stage.durationSeconds,
        promptTokens:     live.promptTokens     ?? stage.promptTokens,
        completionTokens: live.completionTokens ?? stage.completionTokens,
        totalTokens:      live.totalTokens      ?? stage.totalTokens,
        llmCalls:         live.llmCalls         ?? stage.llmCalls,
        failedCalls:      live.failedCalls      ?? stage.failedCalls,
        latencyMs:        live.latencyMs        ?? stage.latencyMs,
        summary:          live.summary          ?? stage.summary,
      }
    })
  }, [task, liveStageResults])

  // Derive stageTokens (keyed by stage_id) from nodeTokens for Stage List / Flow Graph
  // — concatenates all node tokens for the same stage (acceptable for snippet preview)
  const stageTokens = useMemo(() => {
    if (!nodeTokens) return new Map<string, string>()
    const map = new Map<string, string>()
    for (const [node, tokens] of nodeTokens) {
      const sid = NODE_TO_STAGE[node]
      if (!sid) continue
      map.set(sid, (map.get(sid) ?? '') + tokens)
    }
    return map
  }, [nodeTokens])
  const [selectedStage, setSelectedStage] = useState<AgentStageKey | null>(null)
  const [viewMode, setViewMode] = useState<'dashboard' | 'stages' | 'graph'>('dashboard')

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

  const detailMeta = [
    activeStage.backend,
    activeStage.durationSeconds !== undefined ? formatDuration(activeStage.durationSeconds) : null,
    activeStage.totalTokens !== undefined ? formatTokens(activeStage.totalTokens) : null,
    activeStage.llmCalls !== undefined ? `${activeStage.llmCalls} calls` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  // Determine what to show in the detail panel
  const liveTokenText = stageTokens?.get(activeStage.key) ?? ''
  const finalMarkdown = liveTokenText || extractMarkdownText(activeStage.content)
  // A stage is "live streaming" if any node belonging to it is in activeNodes
  const stageIsActive = activeNodes
    ? [...activeNodes].some(n => NODE_TO_STAGE[n] === activeStage.key)
    : activeStage.status === 'processing'
  const isStreaming = stageIsActive && liveTokenText.length > 0

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
          className={viewMode === 'dashboard' ? 'arm-tab--active' : ''}
          onClick={() => setViewMode('dashboard')}
        >
          📊 Dashboard
        </button>
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

      {/* ── Dashboard view ── */}
      {viewMode === 'dashboard' && (
        <div style={{ gridColumn: '1 / -1' }}>
          <AgentDashboard
            stages={stages}
            activityLog={activityLog}
            nodeTokens={nodeTokens}
            activeNodes={activeNodes}
            selectedStage={selectedStage}
            onSelectStage={(key) => setSelectedStage(key)}
          />
        </div>
      )}

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
                  <div className="agent-stage-card__duration">
                    {stage.backend === 'openclaw' ? 'OpenClaw' : stage.backend === 'process' ? 'Process' : 'Default'}
                  </div>
                )}
                {stage.durationSeconds !== undefined && (
                  <div className="agent-stage-card__duration">{formatDuration(stage.durationSeconds)}</div>
                )}
                {stage.totalTokens !== undefined && (
                  <div className="agent-stage-card__duration">{formatTokens(stage.totalTokens)}</div>
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
            {(activeStage.promptTokens !== undefined || activeStage.completionTokens !== undefined) && (
              <div className="agent-stage-detail__duration">
                in {activeStage.promptTokens ?? 0} · out {activeStage.completionTokens ?? 0}
                {activeStage.failedCalls ? ` · ${activeStage.failedCalls} failed` : ''}
                {activeStage.latencyMs !== undefined ? ` · ${Math.round(activeStage.latencyMs / 1000)}s model latency` : ''}
              </div>
            )}
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
              {(activeStage.promptTokens !== undefined || activeStage.completionTokens !== undefined) && (
                <div className="agent-stage-detail__duration">
                  in {activeStage.promptTokens ?? 0} · out {activeStage.completionTokens ?? 0}
                  {activeStage.failedCalls ? ` · ${activeStage.failedCalls} failed` : ''}
                  {activeStage.latencyMs !== undefined ? ` · ${Math.round(activeStage.latencyMs / 1000)}s model latency` : ''}
                </div>
              )}
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
