import { useEffect, useMemo, useState } from 'react'
import type { AnalysisTask } from '../services/tradingService'
import { AGENT_STAGES, buildStageProgress, firstStageWithContent, type AgentStageKey } from './agentStages'

interface AgentResultsModuleProps {
  task?: AnalysisTask | null
}

const formatDuration = (seconds?: number) => {
  if (seconds === undefined) return ''
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const remaining = Math.floor(seconds % 60)
  return `${minutes}m ${remaining}s`
}

const formatContent = (value: unknown) => {
  if (value === null || value === undefined) return 'No stage output yet.'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function AgentResultsModule({ task }: AgentResultsModuleProps) {
  const stages = useMemo(() => buildStageProgress(task), [task])
  const [selectedStage, setSelectedStage] = useState<AgentStageKey | null>(null)

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

  return (
    <div className="agent-results-module">
      <div className="agent-results-module__stages">
        {stages.map((stage) => (
          <button
            key={stage.key}
            type="button"
            className={`agent-stage-card agent-stage-card--${stage.status} ${stage.key === activeStage.key ? 'agent-stage-card--active' : ''}`}
            onClick={() => setSelectedStage(stage.key)}
          >
            <div className="agent-stage-card__header">
              <span className="agent-stage-card__label">{stage.label}</span>
              <span className={`agent-stage-card__badge agent-stage-card__badge--${stage.status}`}>
                {stage.status.toUpperCase()}
              </span>
            </div>
            {stage.durationSeconds !== undefined && (
              <div className="agent-stage-card__duration">{formatDuration(stage.durationSeconds)}</div>
            )}
            <div className="agent-stage-card__summary">
              {stage.summary ?? (stage.status === 'processing' ? 'Stage in progress...' : 'Waiting for output.')}
            </div>
          </button>
        ))}
      </div>

      <div className="agent-stage-detail">
        <div className="agent-stage-detail__header">
          <h4>{activeStage.label}</h4>
          {activeStage.durationSeconds !== undefined && (
            <span className="agent-stage-detail__duration">{formatDuration(activeStage.durationSeconds)}</span>
          )}
        </div>
        <pre className="agent-stage-detail__content">{formatContent(activeStage.content)}</pre>
      </div>
    </div>
  )
}
