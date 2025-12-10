import { useState, useCallback, useEffect } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { tradingService, type AnalysisTask } from '../services/tradingService'
import '../TradingAnalysis.css'

interface TradingAnalysisProps {
    onSessionExpired?: () => void
    llmProvider: string
    llmModel: string
    llmBaseUrl?: string
}

export function TradingAnalysis({ onSessionExpired, llmProvider, llmModel, llmBaseUrl }: TradingAnalysisProps) {
    const [ticker, setTicker] = useState('')
    const [date, setDate] = useState(() => {
        const today = new Date()
        return today.toISOString().split('T')[0]
    })
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [currentTask, setCurrentTask] = useState<AnalysisTask | null>(null)
    const [previousAnalyses, setPreviousAnalyses] = useState<AnalysisTask[]>([])

    // Fetch previous analyses on mount
    useEffect(() => {
        loadPreviousAnalyses()
    }, [])

    const loadPreviousAnalyses = useCallback(async () => {
        try {
            const result = await tradingService.listAnalyses()
            setPreviousAnalyses(result.tasks.slice(0, 5)) // Show last 5
        } catch (err) {
            // Silent fail for now
            console.error('Failed to load previous analyses:', err)
        }
    }, [])

    const handleTickerChange = (e: ChangeEvent<HTMLInputElement>) => {
        setTicker(e.target.value.toUpperCase())
    }

    const handleDateChange = (e: ChangeEvent<HTMLInputElement>) => {
        setDate(e.target.value)
    }

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault()

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
        setCurrentTask(null)

        try {
            // Submit analysis request
            const llmConfig = {
                provider: llmProvider,
                base_url: llmBaseUrl || undefined,
                quick_think_llm: llmModel,
                deep_think_llm: llmModel,
            }
            const task = await tradingService.requestAnalysis(ticker.trim(), date, llmConfig)
            setCurrentTask(task)

            // Start polling for results
            await tradingService.pollAnalysisResult(
                task.task_id,
                (updatedTask) => {
                    setCurrentTask(updatedTask)
                },
                120, // allow longer-running jobs (up to ~16 minutes with 8s interval)
                8000 // poll every 8 seconds
            )

            // Reload previous analyses
            loadPreviousAnalyses()
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to analyze stock'
            setError(message)

            if (message.includes('401') || message.includes('Session')) {
                onSessionExpired?.()
            }
        } finally {
            setLoading(false)
        }
    }

    const formatConfidence = (confidence?: number) => {
        if (confidence === undefined) return 'N/A'
        return `${(confidence * 100).toFixed(1)}%`
    }

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'completed':
                return '#22c55e'
            case 'failed':
                return '#ef4444'
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

        return (
            <div className="analysis-result">
                <div className="result-header">
                    <h3>{currentTask.ticker}</h3>
                    <span
                        className="status-badge"
                        style={{ backgroundColor: getStatusColor(currentTask.status) }}
                    >
                        {currentTask.status.toUpperCase()}
                    </span>
                </div>

                {currentTask.status === 'processing' && (
                    <div className="processing-indicator">
                        <div className="spinner"></div>
                        <p>Analyzing {currentTask.ticker}... This may take 2-5 minutes.</p>
                        <small>Multi-agent analysis in progress</small>
                    </div>
                )}

                {currentTask.status === 'completed' && currentTask.decision && (
                    <div className="decision-result">
                        <div className="decision-card">
                            <div className="decision-main">
                                <span className="decision-label">Decision</span>
                                <span
                                    className="decision-action"
                                    style={{ color: getDecisionColor(currentTask.decision.action) }}
                                >
                                    {currentTask.decision.action}
                                </span>
                            </div>
                            <div className="decision-confidence">
                                <span className="confidence-label">Confidence</span>
                                <span className="confidence-value">{formatConfidence(currentTask.decision.confidence)}</span>
                            </div>
                        </div>

                        {currentTask.processing_time_seconds && (
                            <div className="analysis-meta">
                                <span>⏱️ Analysis completed in {Math.round(currentTask.processing_time_seconds)}s</span>
                            </div>
                        )}

                        {currentTask.analysis_report && (
                            <details className="analysis-details">
                                <summary>📊 View Detailed Analysis Report</summary>
                                <div className="report-content">
                                    <pre>{JSON.stringify(currentTask.analysis_report, null, 2)}</pre>
                                </div>
                            </details>
                        )}
                    </div>
                )}

                {currentTask.status === 'failed' && (
                    <div className="error-result">
                        <p>❌ Analysis failed</p>
                        {currentTask.error && <small>{currentTask.error}</small>}
                    </div>
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
                    className="analyze-button"
                    disabled={loading || !ticker.trim()}
                >
                    {loading ? (
                        <>
                            <span className="button-spinner"></span>
                            Analyzing...
                        </>
                    ) : (
                        '🚀 Analyze Stock'
                    )}
                </button>
            </form>

            {renderAnalysisResult()}

            {previousAnalyses.length > 0 && !loading && !currentTask && (
                <div className="previous-analyses">
                    <h4>Recent Analyses</h4>
                    <div className="analyses-list">
                        {previousAnalyses.map((task) => (
                            <div key={task.task_id} className="analysis-item">
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
                                    <span className="item-date">{new Date(task.CreatedAt).toLocaleString()}</span>
                                    {task.llm_provider && (
                                        <span className="item-provider">
                                            {task.llm_provider}{task.llm_model ? ` / ${task.llm_model}` : ''}
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
