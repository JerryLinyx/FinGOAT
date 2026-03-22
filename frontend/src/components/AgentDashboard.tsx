import { useEffect, useRef, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { StageProgress, ActivityEntry, AgentStageKey } from './agentStages'
import {
  EXECUTION_PHASES,
  NODE_LABEL, NODE_ICON, NODE_TO_STAGE,
  STAGE_LABEL_MAP,
  aggregateStats,
} from './agentStages'

interface AgentDashboardProps {
  stages: StageProgress[]
  activityLog: ActivityEntry[]
  /** Tokens keyed by LangGraph node name e.g. "Bull Researcher" */
  nodeTokens?: Map<string, string>
  /** Set of currently-active LangGraph node names */
  activeNodes?: Set<string>
  selectedStage: AgentStageKey | null
  onSelectStage: (key: AgentStageKey) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = {
  time: (ts: number) => new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  dur: (s?: number) => {
    if (s === undefined) return ''
    if (s < 10) return `${s.toFixed(1)}s`
    if (s < 60) return `${Math.round(s)}s`
    return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`
  },
  tok: (n: number) => {
    if (n < 1000) return `${n}`
    if (n < 100_000) return `${(n / 1000).toFixed(1)}k`
    return `${Math.round(n / 1000)}k`
  },
}

const statusIcon = (s: string) => ({ completed: '✓', failed: '✕', cancelled: '⏹', processing: '◉', pending: '○' }[s] ?? '○')

const ACTIVITY_ICONS: Record<ActivityEntry['type'], string> = {
  token: '💭', stage_start: '▶', stage_end: '✓', task_info: 'ℹ', error: '⚠',
}
const activityIcon = (type: ActivityEntry['type']) => ACTIVITY_ICONS[type] ?? '·'

const ACTIVITY_CLASSES: Partial<Record<ActivityEntry['type'], string>> = {
  stage_start: 'dash-activity__type--start',
  stage_end:   'dash-activity__type--end',
  error:       'dash-activity__type--error',
}
const activityClass = (type: ActivityEntry['type']) => ACTIVITY_CLASSES[type] ?? ''

// Extract markdown text from arbitrary stage content
const PRIO_KEYS = ['judge_decision', 'current_response', 'summary', 'recommendation', 'signal', 'decision', 'action', 'reasoning', 'explanation', 'rationale', 'analysis']
function extractMd(content: unknown): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (typeof content === 'object' && !Array.isArray(content)) {
    const obj = content as Record<string, unknown>
    for (const k of PRIO_KEYS) if (k in obj && typeof obj[k] === 'string' && (obj[k] as string).trim()) return obj[k] as string
    try { return '```json\n' + JSON.stringify(obj, null, 2) + '\n```' } catch { return String(content) }
  }
  if (Array.isArray(content)) return content.map(extractMd).filter(Boolean).join('\n\n')
  return String(content)
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AgentDashboard({ stages, activityLog, nodeTokens, activeNodes, selectedStage, onSelectStage }: AgentDashboardProps) {
  const feedRef = useRef<HTMLDivElement>(null)

  const stageByKey = useMemo(
    () => Object.fromEntries(stages.map(s => [s.key, s])) as Record<AgentStageKey, StageProgress>,
    [stages],
  )
  const stats = useMemo(() => aggregateStats(stages), [stages])

  // Auto-scroll feed to bottom when new entries arrive
  useEffect(() => {
    const el = feedRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) el.scrollTop = el.scrollHeight
  }, [activityLog.length])

  // Find the best node to show in the report panel
  const reportNode = useMemo(() => {
    // Prefer currently active node
    if (activeNodes?.size) return [...activeNodes][activeNodes.size - 1]
    // Fall back: last node that has tokens
    if (nodeTokens?.size) {
      const entries = [...nodeTokens.entries()]
      return entries[entries.length - 1][0]
    }
    return null
  }, [activeNodes, nodeTokens])

  const reportStageId = reportNode ? NODE_TO_STAGE[reportNode] : null
  const reportStage = reportStageId ? stageByKey[reportStageId] : null

  const reportMarkdown = useMemo(() => {
    if (reportNode && nodeTokens?.has(reportNode)) return nodeTokens.get(reportNode) ?? ''
    if (reportStage?.hasContent) return extractMd(reportStage.content)
    // Fallback: latest completed stage with content
    for (let i = stages.length - 1; i >= 0; i--) {
      if (stages[i].hasContent) return extractMd(stages[i].content)
    }
    return ''
  }, [reportNode, nodeTokens, reportStage, stages])

  const isReportStreaming = !!(activeNodes?.size && reportNode)

  // Phase-level status
  const phaseStatus = (phase: typeof EXECUTION_PHASES[0]) => {
    const hasActive = phase.nodes.some(n => activeNodes?.has(n))
    if (hasActive) return 'processing'
    const ss = phase.stageIds.map(id => stageByKey[id]?.status ?? 'pending')
    if (ss.some(s => s === 'failed')) return 'failed'
    if (ss.every(s => s === 'completed')) return 'completed'
    if (ss.some(s => s === 'completed')) return 'partial'
    return 'pending'
  }

  return (
    <div className="dash">
      {/* ── Main layout: left flow + right feed/report ── */}
      <div className="dash-main">

        {/* ── LEFT: Execution flow by phase ── */}
        <div className="dash-flow">
          {EXECUTION_PHASES.map(phase => {
            const ps = phaseStatus(phase)
            return (
              <div key={phase.id} className={`dash-phase dash-phase--${ps}`}>
                {/* Phase header */}
                <div className="dash-phase__hdr">
                  <span className="dash-phase__icon">{phase.icon}</span>
                  <span className="dash-phase__label">{phase.label}</span>
                  {phase.isParallel && <span className="dash-phase__parallel-tag">parallel</span>}
                  <span className={`dash-phase__status-dot dash-phase__status-dot--${ps}`}>
                    {ps === 'processing' ? <span className="dash-status-dot" /> : statusIcon(ps)}
                  </span>
                  <span className="dash-phase__desc">{phase.description}</span>
                </div>

                {/* ── Parallel analyst grid (2 × 2) ── */}
                {phase.isParallel ? (
                  <div className="dash-analyst-grid">
                    {phase.nodes.map(node => {
                      const sid = NODE_TO_STAGE[node] as AgentStageKey
                      const stage = stageByKey[sid]
                      const isActive = activeNodes?.has(node) ?? false
                      const tokens = nodeTokens?.get(node) ?? ''
                      const tokenLen = tokens.length
                      const nodeStatus = isActive ? 'processing' : (stage?.status ?? 'pending')
                      const snippet = isActive ? tokens.slice(-90) : (stage?.summary?.slice(0, 90) ?? '')

                      return (
                        <div
                          key={node}
                          className={[
                            'dash-agent-card',
                            `dash-agent-card--${nodeStatus}`,
                            selectedStage === sid ? 'dash-agent-card--selected' : '',
                          ].filter(Boolean).join(' ')}
                          onClick={() => onSelectStage(sid)}
                        >
                          <div className="dash-agent-card__hdr">
                            <span className="dash-agent-card__name">{NODE_ICON[node]} {NODE_LABEL[node]}</span>
                            {isActive
                              ? <span className="dash-status-dot dash-status-dot--sm" />
                              : <span className="dash-agent-card__badge">{statusIcon(nodeStatus)}</span>
                            }
                          </div>
                          {tokenLen > 0 && (
                            <div className="dash-agent-card__meta">
                              {fmt.tok(tokenLen)} chars
                              {stage?.totalTokens !== undefined ? ` · ${fmt.tok(stage.totalTokens)} tok` : ''}
                              {stage?.durationSeconds !== undefined ? ` · ${fmt.dur(stage.durationSeconds)}` : ''}
                            </div>
                          )}
                          {snippet ? (
                            <div className="dash-agent-card__snippet">{snippet}{isActive ? '▍' : ''}</div>
                          ) : (
                            <div className="dash-agent-card__waiting">
                              {nodeStatus === 'pending' ? 'waiting…' : nodeStatus}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  /* ── Sequential agent rows ── */
                  <div className="dash-seq-agents">
                    {phase.nodes.map((node, idx) => {
                      const sid = NODE_TO_STAGE[node] as AgentStageKey
                      const stage = stageByKey[sid]
                      const isActive = activeNodes?.has(node) ?? false
                      const tokens = nodeTokens?.get(node) ?? ''
                      const nodeStatus = isActive ? 'processing' : (stage?.status ?? 'pending')

                      return (
                        <div key={node} className="dash-seq-row">
                          {idx > 0 && <div className="dash-seq-row__arrow">↓</div>}
                          <div
                            className={[
                              'dash-seq-agent',
                              `dash-seq-agent--${nodeStatus}`,
                              selectedStage === sid ? 'dash-seq-agent--selected' : '',
                            ].filter(Boolean).join(' ')}
                            onClick={() => onSelectStage(sid)}
                          >
                            <span className="dash-seq-agent__name">{NODE_ICON[node]} {NODE_LABEL[node]}</span>
                            <span className={`dash-seq-agent__status dash-seq-agent__status--${nodeStatus}`}>
                              {isActive ? (
                                <>
                                  <span className="dash-status-dot dash-status-dot--sm" />
                                  <span>{fmt.tok(tokens.length)} chars</span>
                                </>
                              ) : (
                                <>
                                  <span>{statusIcon(nodeStatus)}</span>
                                  {nodeStatus === 'completed' && stage?.durationSeconds !== undefined
                                    && <span> {fmt.dur(stage.durationSeconds)}</span>}
                                  {nodeStatus === 'completed' && stage?.totalTokens !== undefined
                                    && <span> · {fmt.tok(stage.totalTokens)}tok</span>}
                                </>
                              )}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ── RIGHT column: Activity feed + Report ── */}
        <div className="dash-right">
          {/* Activity feed */}
          <div className="dash-panel dash-activity">
            <div className="dash-panel__header">
              <span className="dash-panel__title">Messages &amp; Tools</span>
              <span className="dash-panel__badge">{activityLog.length}</span>
            </div>
            <div className="dash-activity__feed" ref={feedRef}>
              {activityLog.length === 0 ? (
                <div className="dash-activity__empty">Waiting for agent activity…</div>
              ) : (
                activityLog.slice(-60).map(entry => (
                  <div key={entry.id} className={`dash-activity__entry ${activityClass(entry.type)}`}>
                    <span className="dash-activity__time">{fmt.time(entry.timestamp)}</span>
                    <span className="dash-activity__icon">{activityIcon(entry.type)}</span>
                    {(entry.nodeLabel ?? entry.stageId) && (
                      <span
                        className="dash-activity__stage"
                        onClick={() => entry.stageId && onSelectStage(entry.stageId as AgentStageKey)}
                      >
                        {entry.nodeLabel ?? (STAGE_LABEL_MAP[entry.stageId as AgentStageKey] ?? entry.stageId)}
                      </span>
                    )}
                    <span className="dash-activity__content">{entry.content}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Current report */}
          <div className="dash-panel dash-report">
            <div className="dash-panel__header">
              <span className="dash-panel__title">
                Current Report
                {(reportNode || reportStage) && (
                  <span className="dash-report__section">
                    {' '}—{' '}
                    {reportNode
                      ? `${NODE_ICON[reportNode] ?? ''} ${NODE_LABEL[reportNode] ?? reportNode}`
                      : `${reportStage?.icon ?? ''} ${reportStage?.label ?? ''}`}
                  </span>
                )}
              </span>
            </div>
            <div className="dash-report__body">
              {reportMarkdown ? (
                <div className="stage-markdown-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{reportMarkdown}</ReactMarkdown>
                  {isReportStreaming && <span className="streaming-cursor">▍</span>}
                </div>
              ) : (
                <div className="dash-report__empty">Waiting for analysis report…</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Stats footer ── */}
      <div className="dash-stats">
        <div className="dash-stats__item">
          <span className="dash-stats__value">{stats.llmCalls || '—'}</span>
          <span className="dash-stats__label">LLM Calls</span>
        </div>
        <div className="dash-stats__sep" />
        <div className="dash-stats__item">
          <span className="dash-stats__value">{stats.totalTokens ? fmt.tok(stats.totalTokens) : '—'}</span>
          <span className="dash-stats__label">Tokens</span>
        </div>
        <div className="dash-stats__sep" />
        <div className="dash-stats__item">
          <span className="dash-stats__value">
            {stats.promptTokens ? fmt.tok(stats.promptTokens) : '—'}
            {' / '}
            {stats.completionTokens ? fmt.tok(stats.completionTokens) : '—'}
          </span>
          <span className="dash-stats__label">In / Out</span>
        </div>
        <div className="dash-stats__sep" />
        <div className="dash-stats__item">
          <span className="dash-stats__value">{stats.reportsGenerated}/{stats.totalStages}</span>
          <span className="dash-stats__label">Reports</span>
        </div>
        <div className="dash-stats__sep" />
        <div className="dash-stats__item">
          <span className="dash-stats__value">{stats.failedCalls || '—'}</span>
          <span className="dash-stats__label">Failed</span>
        </div>
        <div className="dash-stats__sep" />
        <div className="dash-stats__item">
          <span className="dash-stats__value">{fmt.dur(stats.totalDuration) || '—'}</span>
          <span className="dash-stats__label">Duration</span>
        </div>
      </div>
    </div>
  )
}
