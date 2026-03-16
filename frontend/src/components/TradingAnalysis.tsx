import { useState, useCallback, useEffect, useRef } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { tradingService, type AnalysisTask, type StreamEvent } from '../services/tradingService'
import { AgentResultsModule } from './AgentResultsModule'
import '../TradingAnalysis.css'

interface TradingAnalysisProps {
    onSessionExpired?: () => void
    llmProvider: string
    llmModel: string
    llmBaseUrl?: string
    executionMode: 'default' | 'openclaw'
}

export function TradingAnalysis({ onSessionExpired, llmProvider, llmModel, llmBaseUrl, executionMode }: TradingAnalysisProps) {
    const ACTIVE_TASK_STORAGE_KEY = 'fingoat_active_analysis_task_id'
    const [ticker, setTicker] = useState('')
    const [date, setDate] = useState(() => {
        const today = new Date()
        return today.toISOString().split('T')[0]
    })
    const [loading, setLoading] = useState(false)
    const [taskActionLoading, setTaskActionLoading] = useState(false)
    const [error, setError] = useState('')
    const [currentTask, setCurrentTask] = useState<AnalysisTask | null>(null)
    const [previousAnalyses, setPreviousAnalyses] = useState<AnalysisTask[]>([])
    const [stageTokens, setStageTokens] = useState<Map<string, string>>(new Map())
    const pollingTaskIdRef = useRef<string | null>(null)
    const pollCancelledRef = useRef(false)

    const persistActiveTask = useCallback((task: AnalysisTask | null) => {
        if (!task || task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
            localStorage.removeItem(ACTIVE_TASK_STORAGE_KEY)
            return
        }
        localStorage.setItem(ACTIVE_TASK_STORAGE_KEY, task.task_id)
    }, [])

    const applyTaskState = useCallback((task: AnalysisTask | null) => {
        setCurrentTask((previousTask) => {
            if (
                task &&
                previousTask &&
                task.task_id === previousTask.task_id &&
                ((!task.analysis_report && previousTask.analysis_report) ||
                    ((!task.stages || task.stages.length === 0) && previousTask.stages && previousTask.stages.length > 0))
            ) {
                return {
                    ...task,
                    analysis_report: task.analysis_report ?? previousTask.analysis_report,
                    stages: task.stages && task.stages.length > 0 ? task.stages : previousTask.stages,
                }
            }
            return task
        })
        setLoading(task?.status === 'processing' || task?.status === 'pending')
        persistActiveTask(task)
    }, [persistActiveTask])

    // Fetch previous analyses on mount
    const loadPreviousAnalyses = useCallback(async () => {
        try {
            const result = await tradingService.listAnalyses()
            setPreviousAnalyses(result.tasks.slice(0, 5)) // Show last 5
        } catch (err) {
            // Silent fail for now
            console.error('Failed to load previous analyses:', err)
        }
    }, [])

    useEffect(() => {
        loadPreviousAnalyses()
    }, [loadPreviousAnalyses])

    useEffect(() => {
        return () => {
            pollCancelledRef.current = true
        }
    }, [])

    // Live 1-second tick — drives both the elapsed counter and the relative-time labels
    const [, setTickCount] = useState(0)
    useEffect(() => {
        if (!currentTask || (currentTask.status !== 'processing' && currentTask.status !== 'pending')) return
        const id = setInterval(() => setTickCount((n) => n + 1), 1000)
        return () => clearInterval(id)
    }, [currentTask?.task_id, currentTask?.status])

    // ── SSE streaming connection ──────────────────────────────────────────────
    useEffect(() => {
        if (!currentTask?.task_id) return
        if (currentTask.status === 'completed' || currentTask.status === 'failed' || currentTask.status === 'cancelled') return

        const token = tradingService.getAuthToken() ?? ''
        if (!token) return

        setStageTokens(new Map()) // reset on new task / status change

        const cleanup = tradingService.streamAnalysis(currentTask.task_id, (event: StreamEvent) => {
            if (event.type === 'token' && event.stage_id && event.t) {
                setStageTokens(prev => {
                    const next = new Map(prev)
                    next.set(event.stage_id!, (next.get(event.stage_id!) ?? '') + event.t!)
                    return next
                })
            } else if (event.type === 'stage_end') {
                // Refresh task state for updated stages
                tradingService.getAnalysisResult(currentTask.task_id).then(applyTaskState).catch(() => {})
            } else if (event.type === 'task_complete' || event.type === 'task_error') {
                tradingService.getAnalysisResult(currentTask.task_id).then(applyTaskState).catch(() => {})
                loadPreviousAnalyses()
            }
        }, token)

        return () => {
            cleanup()
        }
    }, [currentTask?.task_id, currentTask?.status, applyTaskState, loadPreviousAnalyses])

    const pollTask = useCallback(async (taskId: string) => {
        pollingTaskIdRef.current = taskId
        pollCancelledRef.current = false

        while (!pollCancelledRef.current && pollingTaskIdRef.current === taskId) {
            const latestTask = await tradingService.getAnalysisResult(taskId)
            applyTaskState(latestTask)

            if (latestTask.status === 'completed' || latestTask.status === 'failed' || latestTask.status === 'cancelled') {
                pollingTaskIdRef.current = null
                loadPreviousAnalyses()
                return latestTask
            }

            await new Promise((resolve) => setTimeout(resolve, 4000))
        }

        return null
    }, [applyTaskState, loadPreviousAnalyses])

    const openTask = useCallback(async (taskId: string) => {
        try {
            setError('')
            const task = await tradingService.getAnalysisResult(taskId)
            applyTaskState(task)

            if (task.status === 'processing') {
                await pollTask(task.task_id)
            } else {
                pollingTaskIdRef.current = null
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to load analysis'
            setError(message)

            if (message.includes('401') || message.includes('Session')) {
                onSessionExpired?.()
            }
        }
    }, [applyTaskState, onSessionExpired, pollTask])

    useEffect(() => {
        const activeTaskId = localStorage.getItem(ACTIVE_TASK_STORAGE_KEY)
        if (!activeTaskId) {
            return
        }
        openTask(activeTaskId)
    }, [openTask])

    const handleTickerChange = (e: ChangeEvent<HTMLInputElement>) => {
        setTicker(e.target.value.toUpperCase())
    }

    const handleDateChange = (e: ChangeEvent<HTMLInputElement>) => {
        setDate(e.target.value)
    }

    const [isLaunching, setIsLaunching] = useState(false)

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault()
        if (!ticker.trim() || loading) return

        setError('')
        setIsLaunching(true)
        
        // Brief delay to let the rocket launch animation play
        await new Promise(resolve => setTimeout(resolve, 600))
        
        setIsLaunching(false)
        setLoading(true)
        applyTaskState(null)

        if (!ticker.trim()) {
            setError('Please enter a stock ticker')
            return
        }

        if (!date) {
            setError('Please select a date')
            return
        }

        setError('')
        setLoading(true)
        applyTaskState(null)

        // Duplicate-run guard
        const duplicate = previousAnalyses.find(
            t => t.ticker.toUpperCase() === ticker.toUpperCase() &&
                 t.analysis_date === date &&
                 (t.status === 'completed' || t.status === 'processing' || t.status === 'pending')
        )
        if (duplicate) {
            const ok = window.confirm(
                `You already have a ${duplicate.status} analysis for ${ticker.toUpperCase()} on ${date}.\n\nCreate a new analysis anyway?`
            )
            if (!ok) {
                setLoading(false)
                return
            }
        }

        try {
            // Submit analysis request
            const llmConfig = {
                provider: llmProvider,
                base_url: llmBaseUrl || undefined,
                quick_think_llm: llmModel,
                deep_think_llm: llmModel,
            }
            const task = await tradingService.requestAnalysis(ticker.trim(), date, llmConfig, executionMode)
            applyTaskState(task)
            await pollTask(task.task_id)
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to analyze stock'
            setError(message)

            if (message.includes('401') || message.includes('Session')) {
                onSessionExpired?.()
            }
        } finally {
            if (pollingTaskIdRef.current === null) {
                setLoading(false)
            }
        }
    }

    const handleSelectRecentAnalysis = (taskId: string) => {
        pollCancelledRef.current = true
        pollingTaskIdRef.current = null
        openTask(taskId)
    }

    const handleClearCurrentTask = () => {
        pollCancelledRef.current = true
        pollingTaskIdRef.current = null
        applyTaskState(null)
        setError('')
    }

    const handleCancelTask = async () => {
        if (!currentTask) return

        try {
            setTaskActionLoading(true)
            pollCancelledRef.current = true
            pollingTaskIdRef.current = null
            const task = await tradingService.cancelAnalysis(currentTask.task_id)
            applyTaskState(task)
            loadPreviousAnalyses()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to terminate analysis')
        } finally {
            setTaskActionLoading(false)
        }
    }

    const handleResumeTask = async () => {
        if (!currentTask) return

        try {
            setTaskActionLoading(true)
            setError('')
            const task = await tradingService.resumeAnalysis(currentTask.task_id)
            applyTaskState(task)
            await pollTask(task.task_id)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to continue analysis')
        } finally {
            setTaskActionLoading(false)
        }
    }

    const formatConfidence = (confidence?: number) => {
        if (confidence === undefined) return 'N/A'
        return `${(confidence * 100).toFixed(1)}%`
    }

    const formatElapsed = (startIso?: string) => {
        if (!startIso) return ''
        const seconds = Math.floor((Date.now() - new Date(startIso).getTime()) / 1000)
        if (seconds < 0) return ''
        const m = Math.floor(seconds / 60)
        const s = seconds % 60
        return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`
    }

    const formatRelativeTime = (value?: string) => {
        if (!value) return 'N/A'
        const parsed = new Date(value)
        if (Number.isNaN(parsed.getTime())) return 'N/A'
        const diffMs = Date.now() - parsed.getTime()
        const diffSec = Math.max(0, Math.round(diffMs / 1000))
        if (diffSec < 10) return 'just now'
        if (diffSec < 60) return `${diffSec}s ago`
        const diffMin = Math.round(diffSec / 60)
        if (diffMin < 60) return `${diffMin}m ago`
        const diffHr = Math.round(diffMin / 60)
        if (diffHr < 24) return `${diffHr}h ago`
        return parsed.toLocaleString()
    }

    const getStageStats = (task: AnalysisTask | null) => {
        const stages = task?.stages ?? []
        const completed = stages.filter((stage) => stage.status === 'completed').length
        const processingStage = stages.find((stage) => stage.status === 'processing')
        const failedStage = stages.find((stage) => stage.status === 'failed')
        const activeLabel =
            failedStage?.label ??
            processingStage?.label ??
            stages.find((stage) => stage.status === 'completed')?.label ??
            null
        return {
            total: stages.length,
            completed,
            percent: stages.length > 0 ? Math.round((completed / stages.length) * 100) : 0,
            activeLabel,
        }
    }

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'completed':
                return '#22c55e'
            case 'failed':
                return '#ef4444'
            case 'cancelled':
                return '#f97316'
            case 'processing':
                return '#3b82f6'
            default:
                return '#6b7280'
        }
    }

    const getDecisionColor = (action?: string) => {
        switch (action) {
            case 'BUY':
                return '#10b981'
            case 'SELL':
                return '#ef4444'
            case 'HOLD':
                return '#f59e0b'
            default:
                return '#6b7280'
        }
    }

    const renderAnalysisResult = () => {
        if (!currentTask) return null
        const stageStats = getStageStats(currentTask)
        const lastUpdatedLabel = formatRelativeTime(currentTask.updated_at)

        return (
            <div className="analysis-result">
                <div className="result-header">
                    <h3>{currentTask.ticker}</h3>
                    <div className="result-header-actions">
                        <span className="status-badge" style={{ backgroundColor: '#1f2937' }}>
                            {currentTask.execution_mode === 'openclaw' ? 'OPENCLAW' : 'DEFAULT'}
                        </span>
                        <span
                            className="status-badge"
                            style={{ backgroundColor: getStatusColor(currentTask.status) }}
                        >
                            {currentTask.status.toUpperCase()}
                        </span>
                        {(currentTask.status === 'pending' || currentTask.status === 'processing') && (
                            <button
                                type="button"
                                className="secondary-button"
                                onClick={handleCancelTask}
                                disabled={taskActionLoading}
                            >
                                Terminate
                            </button>
                        )}
                        {(currentTask.status === 'failed' || currentTask.status === 'cancelled') && (
                            <button
                                type="button"
                                className="secondary-button"
                                onClick={handleResumeTask}
                                disabled={taskActionLoading}
                            >
                                Continue
                            </button>
                        )}
                        {currentTask.status !== 'processing' && (
                            <button type="button" className="secondary-button" onClick={handleClearCurrentTask}>
                                Back to Recent Analyses
                            </button>
                        )}
                    </div>
                </div>


                {currentTask.status === 'pending' && (
                    <>
                        <div className="processing-bar">
                            <div className="spinner spinner--sm"></div>
                            <span className="processing-bar__label">
                                <strong>{currentTask.ticker}</strong> is queued · {lastUpdatedLabel}
                            </span>
                        </div>
                        <AgentResultsModule task={currentTask} stageTokens={stageTokens} />
                    </>
                )}

                {currentTask.status === 'processing' && (
                    <>
                        <div className="processing-bar">
                            <div className="spinner spinner--sm"></div>
                            <span className="processing-bar__label">
                                Analyzing <strong>{currentTask.ticker}</strong>
                                {stageStats.activeLabel && <> · {stageStats.activeLabel}</>}
                            </span>
                            <span className="processing-bar__elapsed">⏱ {formatElapsed(currentTask.created_at)}</span>
                        </div>
                        <AgentResultsModule task={currentTask} stageTokens={stageTokens} />
                    </>
                )}

                {currentTask.status === 'completed' && currentTask.decision && (
                    <div className="decision-result">
                        <div className={`decision-card decision-card--${currentTask.decision.action?.toLowerCase() ?? 'hold'}`}>
                            <span className="decision-label">Decision</span>
                            <span
                                className="decision-action"
                                style={{ color: getDecisionColor(currentTask.decision.action) }}
                            >
                                {currentTask.decision.action}
                            </span>
                            <span className="decision-sep">·</span>
                            <span className="confidence-label">Confidence</span>
                            <span className="confidence-value">{formatConfidence(currentTask.decision.confidence)}</span>
                            {currentTask.processing_time_seconds && (
                                <span className="decision-time">⏱ {Math.round(currentTask.processing_time_seconds)}s</span>
                            )}
                        </div>

                        <AgentResultsModule task={currentTask} stageTokens={stageTokens} />

                        {currentTask.analysis_report && (
                            <details className="analysis-details">
                                <summary>📊 View Raw Analysis Report</summary>
                                <div className="report-content">
                                    <pre>{JSON.stringify(currentTask.analysis_report, null, 2)}</pre>
                                </div>
                            </details>
                        )}
                    </div>
                )}

                {currentTask.status === 'failed' && (
                    <>
                        <div className="error-result">
                            <p>❌ Analysis failed</p>
                            {currentTask.error && <small>{currentTask.error}</small>}
                        </div>
                        <AgentResultsModule task={currentTask} stageTokens={stageTokens} />
                    </>
                )}

                {currentTask.status === 'cancelled' && (
                    <>
                        <div className="error-result">
                            <p>⏹ Analysis cancelled</p>
                            {currentTask.error && <small>{currentTask.error}</small>}
                        </div>
                        <AgentResultsModule task={currentTask} stageTokens={stageTokens} />
                    </>
                )}
            </div>
        )
    }

    return (
        <div className="trading-analysis-container">
            <form onSubmit={handleSubmit} className="analysis-form">
                <div className="form-row">
                    <div className="form-group">
                        <label htmlFor="ticker">Stock Ticker</label>
                        <input
                            id="ticker"
                            type="text"
                            placeholder="e.g., NVDA, AAPL, TSLA"
                            value={ticker}
                            onChange={handleTickerChange}
                            disabled={loading}
                            maxLength={10}
                            style={{ textTransform: 'uppercase' }}
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="date">Analysis Date</label>
                        <input
                            id="date"
                            type="date"
                            value={date}
                            onChange={handleDateChange}
                            disabled={loading}
                            max={new Date().toISOString().split('T')[0]}
                        />
                    </div>
                </div>

                {error && <div className="form-error">{error}</div>}

                <button
                    type="submit"
                    className={`analyze-button ${isLaunching ? 'launching' : ''}`}
                    disabled={loading || isLaunching || !ticker.trim()}
                >
                    {(loading || isLaunching) ? (
                        <>
                            <span className={isLaunching ? 'rocket-icon launching' : 'button-spinner'}>
                                {isLaunching ? '🚀' : ''}
                            </span>
                            {isLaunching ? 'Launching...' : 'Analyzing...'}
                        </>
                    ) : (
                        <>
                            <span className="rocket-icon">🚀</span> Analyze Stock
                        </>
                    )}
                </button>
            </form>

            {renderAnalysisResult()}

            {previousAnalyses.length > 0 && !loading && !currentTask && (
                <div className="previous-analyses">
                    <h4>Recent Analyses</h4>
                    <div className="analyses-list">
                        {previousAnalyses.map((task) => (
                            <button
                                key={task.task_id}
                                type="button"
                                className="analysis-item"
                                onClick={() => handleSelectRecentAnalysis(task.task_id)}
                            >
                                <div className="item-header">
                                    <strong>{task.ticker}</strong>
                                    <span style={{ color: getStatusColor(task.status), fontSize: '0.85em' }}>
                                        {task.status}
                                    </span>
                                </div>
                                {task.decision && (
                                    <div className="item-decision">
                                        <span style={{ color: getDecisionColor(task.decision.action) }}>
                                            {task.decision.action}
                                        </span>
                                        <span>{formatConfidence(task.decision.confidence)}</span>
                                    </div>
                                )}
                                <div className="item-meta-row">
                                    <span className="item-date">{new Date(task.created_at).toLocaleString()}</span>
                                    {task.llm_provider && (
                                        <span className="item-provider">
                                            {task.llm_provider}{task.llm_model ? ` / ${task.llm_model}` : ''}
                                        </span>
                                    )}
                                </div>
                                <div className="item-meta-row">
                                    <span className="item-provider">
                                        Updated {formatRelativeTime(task.updated_at)}
                                    </span>
                                    <span className="item-provider">
                                        {(() => {
                                            const stats = getStageStats(task)
                                            return stats.total > 0 ? `${stats.completed}/${stats.total} stages` : 'No stage data'
                                        })()}
                                    </span>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
