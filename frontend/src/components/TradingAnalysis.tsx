import { useState, useCallback, useEffect, useRef } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { tradingService, type AnalysisTask, type StreamEvent } from '../services/tradingService'
import type { MarketMode } from '../services/tradingService'
import { AgentResultsModule } from './AgentResultsModule'
import { AnalystLiveGrid, type AnalystLiveCardState } from './AnalystLiveGrid'
import {
  type ActivityEntry,
  nextActivityId, resetActivityId,
  STAGE_LABEL_MAP, type AgentStageKey,
  NODE_TO_STAGE, NODE_LABEL,
  type LiveStageResult, parseLiveStageResult,
} from './agentStages'
import '../TradingAnalysis.css'

type TopLevelAnalystStage = 'market' | 'social' | 'news' | 'fundamentals'

const TOP_LEVEL_ANALYSTS: Array<{ stageId: TopLevelAnalystStage; label: string; nodeName: string }> = [
    { stageId: 'market', label: 'Technical', nodeName: 'Market Analyst' },
    { stageId: 'social', label: 'Social Media', nodeName: 'Social Analyst' },
    { stageId: 'news', label: 'News', nodeName: 'News Analyst' },
    { stageId: 'fundamentals', label: 'Fundamentals', nodeName: 'Fundamentals Analyst' },
]

const createInitialAnalystLiveState = (): Record<TopLevelAnalystStage, AnalystLiveCardState> =>
    Object.fromEntries(
        TOP_LEVEL_ANALYSTS.map((item) => [
            item.stageId,
            {
                stageId: item.stageId,
                label: item.label,
                nodeName: item.nodeName,
                status: 'pending',
                text: '',
                summary: null,
                currentTool: null,
                lastUpdatedAt: null,
                startedAt: null,
                completedAt: null,
                error: null,
            },
        ]),
    ) as Record<TopLevelAnalystStage, AnalystLiveCardState>

interface TradingAnalysisProps {
    onSessionExpired?: () => void
    llmProvider: string
    llmModel: string
    llmBaseUrl?: string
    executionMode: 'default' | 'openclaw'
    configuredProviders: Set<string>
}

export function TradingAnalysis({ onSessionExpired, llmProvider, llmModel, llmBaseUrl, executionMode, configuredProviders }: TradingAnalysisProps) {
    const ACTIVE_TASK_STORAGE_KEY = 'fingoat_active_analysis_task_id'
    const MARKET_STORAGE_KEY = 'fingoat_analysis_market'
    const readStoredMarket = (): MarketMode => (localStorage.getItem(MARKET_STORAGE_KEY) === 'cn' ? 'cn' : 'us')
    const sanitizeTicker = (value: string, currentMarket: MarketMode) => (
        currentMarket === 'cn'
            ? value.replace(/\D/g, '').slice(0, 6)
            : value.toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 10)
    )
    const formatMarketLabel = (value?: MarketMode) => (value === 'cn' ? 'A股' : 'US')

    const [ticker, setTicker] = useState('')
    const [market, setMarket] = useState<MarketMode>(readStoredMarket)
    const [date, setDate] = useState(() => {
        const today = new Date()
        return today.toISOString().split('T')[0]
    })
    const [loading, setLoading] = useState(false)
    const [taskActionLoading, setTaskActionLoading] = useState(false)
    const [error, setError] = useState('')
    const [currentTask, setCurrentTask] = useState<AnalysisTask | null>(null)
    const [previousAnalyses, setPreviousAnalyses] = useState<AnalysisTask[]>([])
    // Per-node accumulated tokens (key = LangGraph node name e.g. "Bull Researcher")
    const [nodeTokens, setNodeTokens] = useState<Map<string, string>>(new Map())
    // Which nodes are currently emitting tokens
    const [activeNodes, setActiveNodes] = useState<Set<string>>(new Set())
    // Parsed stage_end stats, available immediately without waiting for REST poll
    const [liveStageResults, setLiveStageResults] = useState<Map<string, LiveStageResult>>(new Map())
    const [activityLog, setActivityLog] = useState<ActivityEntry[]>([])
    const [analystLive, setAnalystLive] = useState<Record<TopLevelAnalystStage, AnalystLiveCardState>>(createInitialAnalystLiveState)

    // Which nodes have already fired a stage_start log entry (per-run)
    const startedNodesRef = useRef<Set<string>>(new Set())
    // Last node seen per stage_id — used to derive stageTokens and mark inactive
    const lastNodeByStageRef = useRef<Map<string, string>>(new Map())
    // Pending token text per node for batched activity-log flushing
    const nodeBuffersRef = useRef<Map<string, string>>(new Map())
    // Single flush-interval for all node buffers
    const bufferFlushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
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

    useEffect(() => {
        if (!currentTask?.stages || currentTask.stages.length === 0) return

        setAnalystLive((previous) => {
            const next = { ...previous }
            for (const stage of currentTask.stages ?? []) {
                if (!TOP_LEVEL_ANALYSTS.some((item) => item.stageId === stage.stage_id)) continue
                const stageId = stage.stage_id as TopLevelAnalystStage
                next[stageId] = {
                    ...next[stageId],
                    status: stage.status,
                    summary: stage.summary ?? next[stageId].summary,
                    startedAt: stage.started_at ?? next[stageId].startedAt,
                    completedAt: stage.completed_at ?? next[stageId].completedAt,
                    durationSeconds: stage.duration_seconds ?? next[stageId].durationSeconds,
                    totalTokens: stage.total_tokens ?? next[stageId].totalTokens,
                    promptTokens: stage.prompt_tokens ?? next[stageId].promptTokens,
                    completionTokens: stage.completion_tokens ?? next[stageId].completionTokens,
                    llmCalls: stage.llm_calls ?? next[stageId].llmCalls,
                    error: stage.error ?? next[stageId].error,
                }
            }
            return next
        })
    }, [currentTask?.task_id, currentTask?.stages])

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

        // Reset all streaming state for this run
        setNodeTokens(new Map())
        setActiveNodes(new Set())
        setLiveStageResults(new Map())
        setActivityLog([])
        setAnalystLive(createInitialAnalystLiveState())
        resetActivityId()
        startedNodesRef.current = new Set()
        lastNodeByStageRef.current = new Map()
        nodeBuffersRef.current = new Map()

        // Single 500ms interval flushes token snippets from ALL active nodes at once
        bufferFlushTimerRef.current = setInterval(() => {
            const buffers = nodeBuffersRef.current
            if (buffers.size === 0) return
            const newEntries: ActivityEntry[] = []
            for (const [node, text] of buffers) {
                if (!text.trim()) continue
                const snippet = text.length > 100 ? text.slice(0, 97) + '…' : text
                const stageId = NODE_TO_STAGE[node] ?? node as AgentStageKey
                newEntries.push({
                    id: nextActivityId(),
                    timestamp: Date.now(),
                    type: 'token',
                    stageId,
                    node,
                    nodeLabel: NODE_LABEL[node] ?? node,
                    content: snippet,
                })
            }
            if (newEntries.length > 0) {
                setActivityLog(prev => [...prev, ...newEntries])
            }
            nodeBuffersRef.current = new Map()
        }, 500)

        const cleanup = tradingService.streamAnalysis(currentTask.task_id, (event: StreamEvent) => {
            if (event.type === 'token' && event.t) {
                const node = event.node ?? event.stage_id ?? 'unknown'
                const stageId = (event.stage_id ?? '') as AgentStageKey

                // Track last active node per stage (for marking inactive on stage_end)
                lastNodeByStageRef.current.set(stageId, node)

                // Mark node active
                setActiveNodes(prev => {
                    if (prev.has(node)) return prev
                    const next = new Set(prev)
                    next.add(node)
                    return next
                })

                // Accumulate tokens per node
                setNodeTokens(prev => {
                    const next = new Map(prev)
                    next.set(node, (next.get(node) ?? '') + event.t!)
                    return next
                })

                // Per-node stage_start log entry (fires once per node per run)
                if (!startedNodesRef.current.has(node)) {
                    startedNodesRef.current.add(node)
                    const nodeLabel = NODE_LABEL[node] ?? node
                    setActivityLog(prev => [...prev, {
                        id: nextActivityId(),
                        timestamp: Date.now(),
                        type: 'stage_start',
                        stageId,
                        node,
                        nodeLabel,
                        content: `${nodeLabel} started`,
                    }])
                }

                // Buffer token text for the 500ms flush
                nodeBuffersRef.current.set(
                    node,
                    (nodeBuffersRef.current.get(node) ?? '') + event.t,
                )

                if (TOP_LEVEL_ANALYSTS.some((item) => item.stageId === stageId)) {
                    setAnalystLive((previous) => {
                        const next = { ...previous }
                        const topStage = stageId as TopLevelAnalystStage
                        next[topStage] = {
                            ...next[topStage],
                            status: 'processing',
                            nodeName: node,
                            text: `${next[topStage].text}${event.t ?? event.text ?? ''}`,
                            lastUpdatedAt: event.ts ?? new Date().toISOString(),
                        }
                        return next
                    })
                }

            } else if (event.type === 'analyst_start') {
                const stageId = event.stage_id as TopLevelAnalystStage | undefined
                if (!stageId || !TOP_LEVEL_ANALYSTS.some((item) => item.stageId === stageId)) return
                setAnalystLive((previous) => ({
                    ...previous,
                    [stageId]: {
                        ...previous[stageId],
                        status: 'processing',
                        startedAt: event.ts ?? new Date().toISOString(),
                        lastUpdatedAt: event.ts ?? new Date().toISOString(),
                        error: null,
                    },
                }))
                setActivityLog(prev => [...prev, {
                    id: nextActivityId(),
                    timestamp: Date.now(),
                    type: 'stage_start',
                    stageId,
                    node: event.node,
                    nodeLabel: NODE_LABEL[event.node ?? ''] ?? STAGE_LABEL_MAP[stageId],
                    content: `${NODE_LABEL[event.node ?? ''] ?? STAGE_LABEL_MAP[stageId]} started`,
                }])

            } else if (event.type === 'tool_start' || event.type === 'tool_end') {
                const stageId = event.stage_id as TopLevelAnalystStage | undefined
                if (!stageId || !TOP_LEVEL_ANALYSTS.some((item) => item.stageId === stageId)) return
                setAnalystLive((previous) => ({
                    ...previous,
                    [stageId]: {
                        ...previous[stageId],
                        currentTool: event.type === 'tool_start' ? (event.tool ?? 'tool') : null,
                        lastUpdatedAt: event.ts ?? new Date().toISOString(),
                    },
                }))
                setActivityLog(prev => [...prev, {
                    id: nextActivityId(),
                    timestamp: Date.now(),
                    type: 'task_info',
                    stageId,
                    node: event.node,
                    nodeLabel: NODE_LABEL[event.node ?? ''] ?? STAGE_LABEL_MAP[stageId],
                    content: event.type === 'tool_start'
                        ? `Tool started${event.tool ? ` · ${event.tool}` : ''}`
                        : `Tool finished${event.tool ? ` · ${event.tool}` : ''}`,
                }])

            } else if (event.type === 'partial') {
                const stageId = event.stage_id as TopLevelAnalystStage | undefined
                if (!stageId || !TOP_LEVEL_ANALYSTS.some((item) => item.stageId === stageId)) return
                let partialContent = ''
                if (event.data) partialContent = event.data
                setAnalystLive((previous) => ({
                    ...previous,
                    [stageId]: {
                        ...previous[stageId],
                        summary: event.summary ?? previous[stageId].summary,
                        lastUpdatedAt: event.ts ?? new Date().toISOString(),
                        text: partialContent ? partialContent : previous[stageId].text,
                    },
                }))

            } else if (event.type === 'analyst_complete') {
                const stageId = event.stage_id as TopLevelAnalystStage | undefined
                if (!stageId || !TOP_LEVEL_ANALYSTS.some((item) => item.stageId === stageId)) return
                let parsed: Record<string, unknown> = {}
                if (event.data) {
                    try {
                        parsed = JSON.parse(event.data) as Record<string, unknown>
                    } catch {
                        parsed = {}
                    }
                }
                setAnalystLive((previous) => ({
                    ...previous,
                    [stageId]: {
                        ...previous[stageId],
                        status: 'completed',
                        summary: (typeof parsed.summary === 'string' ? parsed.summary : event.summary) ?? previous[stageId].summary,
                        completedAt: (typeof parsed.completed_at === 'string' ? parsed.completed_at : event.ts) ?? previous[stageId].completedAt,
                        lastUpdatedAt: event.ts ?? new Date().toISOString(),
                        durationSeconds: typeof parsed.duration_seconds === 'number' ? parsed.duration_seconds : previous[stageId].durationSeconds,
                        totalTokens: typeof parsed.total_tokens === 'number' ? parsed.total_tokens : previous[stageId].totalTokens,
                        promptTokens: typeof parsed.prompt_tokens === 'number' ? parsed.prompt_tokens : previous[stageId].promptTokens,
                        completionTokens: typeof parsed.completion_tokens === 'number' ? parsed.completion_tokens : previous[stageId].completionTokens,
                        llmCalls: typeof parsed.llm_calls === 'number' ? parsed.llm_calls : previous[stageId].llmCalls,
                        currentTool: null,
                    },
                }))

            } else if (event.type === 'analyst_error') {
                const stageId = event.stage_id as TopLevelAnalystStage | undefined
                if (!stageId || !TOP_LEVEL_ANALYSTS.some((item) => item.stageId === stageId)) return
                const nextStatus = event.status === 'cancelled' ? 'cancelled' : 'failed'
                setAnalystLive((previous) => ({
                    ...previous,
                    [stageId]: {
                        ...previous[stageId],
                        status: nextStatus,
                        error: event.error ?? 'Analyst failed',
                        currentTool: null,
                        lastUpdatedAt: event.ts ?? new Date().toISOString(),
                    },
                }))
                setActivityLog(prev => [...prev, {
                    id: nextActivityId(),
                    timestamp: Date.now(),
                    type: 'error',
                    stageId,
                    node: event.node,
                    nodeLabel: NODE_LABEL[event.node ?? ''] ?? STAGE_LABEL_MAP[stageId],
                    content: event.error ?? 'Analyst failed',
                }])

            } else if (event.type === 'stage_end') {
                const stageId = (event.stage_id ?? '') as AgentStageKey
                const lastNode = lastNodeByStageRef.current.get(stageId)

                // Mark last-active node for this stage as inactive
                if (lastNode) {
                    setActiveNodes(prev => {
                        if (!prev.has(lastNode)) return prev
                        const next = new Set(prev)
                        next.delete(lastNode)
                        return next
                    })
                    // Flush any buffered text for this node immediately
                    const buffered = nodeBuffersRef.current.get(lastNode) ?? ''
                    if (buffered.trim()) {
                        const snippet = buffered.length > 100 ? buffered.slice(0, 97) + '…' : buffered
                        setActivityLog(prev => [...prev, {
                            id: nextActivityId(),
                            timestamp: Date.now(),
                            type: 'token',
                            stageId,
                            node: lastNode,
                            nodeLabel: NODE_LABEL[lastNode] ?? lastNode,
                            content: snippet,
                        }])
                        nodeBuffersRef.current.delete(lastNode)
                    }
                }

                // Parse stage_end data immediately — don't wait for REST
                if (event.data) {
                    const parsed = parseLiveStageResult(event.data)
                    if (parsed) {
                        setLiveStageResults(prev => {
                            const next = new Map(prev)
                            next.set(stageId, parsed)
                            return next
                        })
                    }
                }

                // Activity log entry
                const nodeLabel = lastNode
                    ? (NODE_LABEL[lastNode] ?? lastNode)
                    : (STAGE_LABEL_MAP[stageId] ?? stageId)
                setActivityLog(prev => [...prev, {
                    id: nextActivityId(),
                    timestamp: Date.now(),
                    type: 'stage_end',
                    stageId,
                    node: lastNode,
                    nodeLabel,
                    content: `${nodeLabel} completed`,
                }])

                tradingService.getAnalysisResult(currentTask.task_id).then(applyTaskState).catch(() => {})

            } else if (event.type === 'task_complete' || event.type === 'task_error') {
                setActivityLog(prev => [...prev, {
                    id: nextActivityId(),
                    timestamp: Date.now(),
                    type: event.type === 'task_complete' ? 'task_info' : 'error',
                    content: event.type === 'task_complete' ? 'Analysis complete' : `Error: ${event.error ?? 'unknown'}`,
                }])
                tradingService.getAnalysisResult(currentTask.task_id).then(applyTaskState).catch(() => {})
                loadPreviousAnalyses()
            }
        }, token)

        return () => {
            cleanup()
            if (bufferFlushTimerRef.current) {
                clearInterval(bufferFlushTimerRef.current)
                bufferFlushTimerRef.current = null
            }
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
        setTicker(sanitizeTicker(e.target.value, market))
    }

    const handleDateChange = (e: ChangeEvent<HTMLInputElement>) => {
        setDate(e.target.value)
    }

    const handleMarketChange = (nextMarket: MarketMode) => {
        setMarket(nextMarket)
        localStorage.setItem(MARKET_STORAGE_KEY, nextMarket)
        setTicker((prev) => sanitizeTicker(prev, nextMarket))
        setError('')
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
            setError(market === 'cn' ? '请输入 6 位 A 股代码' : 'Please enter a stock ticker')
            setLoading(false)
            return
        }

        if (!date) {
            setError('Please select a date')
            setLoading(false)
            return
        }

        if (market === 'cn' && !/^\d{6}$/.test(ticker.trim())) {
            setError('A股代码必须是 6 位数字')
            setLoading(false)
            return
        }

        // Require Alpha Vantage API key for US market data fetching
        if (market === 'us' && !configuredProviders.has('alpha_vantage')) {
            setError('Alpha Vantage API key is required — add it in Profile & API Keys')
            setLoading(false)
            return
        }

        setError('')
        setLoading(true)
        applyTaskState(null)

        // Duplicate-run guard
        const duplicate = previousAnalyses.find(
            t => t.ticker.toUpperCase() === ticker.toUpperCase() &&
                 (t.market ?? 'us') === market &&
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
            const task = await tradingService.requestAnalysis(ticker.trim(), market, date, llmConfig, executionMode)
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

    const analystCards = TOP_LEVEL_ANALYSTS.map((definition) => {
        const live = analystLive[definition.stageId]
        const stage = currentTask?.stages?.find((item) => item.stage_id === definition.stageId)
        return {
            ...live,
            status: live.status === 'processing' || live.text || live.currentTool
                ? live.status
                : ((stage?.status as AnalystLiveCardState['status'] | undefined) ?? live.status),
            summary: live.summary ?? stage?.summary ?? null,
            startedAt: live.startedAt ?? stage?.started_at ?? null,
            completedAt: live.completedAt ?? stage?.completed_at ?? null,
            durationSeconds: live.durationSeconds ?? stage?.duration_seconds,
            totalTokens: live.totalTokens ?? stage?.total_tokens,
            promptTokens: live.promptTokens ?? stage?.prompt_tokens,
            completionTokens: live.completionTokens ?? stage?.completion_tokens,
            llmCalls: live.llmCalls ?? stage?.llm_calls,
            error: live.error ?? stage?.error ?? null,
        }
    })

    const renderAnalysisResult = () => {
        if (!currentTask) return null
        const stageStats = getStageStats(currentTask)
        const lastUpdatedLabel = formatRelativeTime(currentTask.updated_at)

        return (
            <div className="analysis-result">
                <div className="result-header">
                    <div className="result-header__title">
                        <h3>{currentTask.ticker}</h3>
                        <span className="market-badge">{formatMarketLabel(currentTask.market)}</span>
                    </div>
                    <div className="result-header-actions">
                        <span className="status-badge" style={{ backgroundColor: '#1f2937' }}>
                            {currentTask.execution_mode === 'openclaw' ? 'OPENCLAW' : 'STANDARD'}
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
                                <strong>{currentTask.ticker}</strong> · {formatMarketLabel(currentTask.market)} is queued · {lastUpdatedLabel}
                            </span>
                        </div>
                        <AnalystLiveGrid analysts={analystCards} />
                        <AgentResultsModule task={currentTask} nodeTokens={nodeTokens} activeNodes={activeNodes} liveStageResults={liveStageResults} activityLog={activityLog} />
                    </>
                )}

                {currentTask.status === 'processing' && (
                    <>
                        <div className="processing-bar">
                            <div className="spinner spinner--sm"></div>
                            <span className="processing-bar__label">
                                Analyzing <strong>{currentTask.ticker}</strong> · {formatMarketLabel(currentTask.market)}
                                {stageStats.activeLabel && <> · {stageStats.activeLabel}</>}
                            </span>
                            <span className="processing-bar__elapsed">⏱ {formatElapsed(currentTask.created_at)}</span>
                        </div>
                        <AnalystLiveGrid analysts={analystCards} />
                        <AgentResultsModule task={currentTask} nodeTokens={nodeTokens} activeNodes={activeNodes} liveStageResults={liveStageResults} activityLog={activityLog} />
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

                        <AnalystLiveGrid analysts={analystCards} />
                        <AgentResultsModule task={currentTask} nodeTokens={nodeTokens} activeNodes={activeNodes} liveStageResults={liveStageResults} activityLog={activityLog} />

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
                        <AnalystLiveGrid analysts={analystCards} />
                        <AgentResultsModule task={currentTask} nodeTokens={nodeTokens} activeNodes={activeNodes} liveStageResults={liveStageResults} activityLog={activityLog} />
                    </>
                )}

                {currentTask.status === 'cancelled' && (
                    <>
                        <div className="error-result">
                            <p>⏹ Analysis cancelled</p>
                            {currentTask.error && <small>{currentTask.error}</small>}
                        </div>
                        <AnalystLiveGrid analysts={analystCards} />
                        <AgentResultsModule task={currentTask} nodeTokens={nodeTokens} activeNodes={activeNodes} liveStageResults={liveStageResults} activityLog={activityLog} />
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
                        <label>Market</label>
                        <div className="market-toggle" role="tablist" aria-label="Select market">
                            <button
                                type="button"
                                className={`market-toggle__btn ${market === 'us' ? 'market-toggle__btn--active' : ''}`}
                                onClick={() => handleMarketChange('us')}
                                disabled={loading}
                            >
                                US
                            </button>
                            <button
                                type="button"
                                className={`market-toggle__btn ${market === 'cn' ? 'market-toggle__btn--active' : ''}`}
                                onClick={() => handleMarketChange('cn')}
                                disabled={loading}
                            >
                                A股
                            </button>
                        </div>
                    </div>

                    <div className="form-group">
                        <label htmlFor="ticker">Stock Ticker</label>
                        <input
                            id="ticker"
                            type="text"
                            placeholder={market === 'cn' ? '例如 600519, 000001, 300750' : 'e.g., NVDA, AAPL, TSLA'}
                            value={ticker}
                            onChange={handleTickerChange}
                            disabled={loading}
                            maxLength={market === 'cn' ? 6 : 10}
                            style={{ textTransform: market === 'cn' ? 'none' : 'uppercase' }}
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
                                    <div className="item-header__title">
                                        <strong>{task.ticker}</strong>
                                        <span className="market-badge market-badge--inline">{formatMarketLabel(task.market)}</span>
                                    </div>
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
