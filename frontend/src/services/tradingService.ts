// Trading Analysis API Service

const rawApiUrl = import.meta.env.VITE_API_URL
const API_BASE_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : ''
const TOKEN_STORAGE_KEY = 'fingoat_token'
export type MarketMode = 'us' | 'cn'

const withBearerToken = (token: string | null): string => {
    if (!token) return ''
    return token.startsWith('Bearer ') ? token : `Bearer ${token}`
}

export interface AnalysisRequest {
    ticker: string
    market?: MarketMode
    date: string
    execution_mode?: 'default' | 'openclaw'
    llm_config?: {
        provider?: string
        base_url?: string
        deep_think_llm?: string
        quick_think_llm?: string
    }
}

export interface AnalysisStage {
    stage_id: string
    label: string
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
    backend: string
    provider: string
    summary?: string | null
    content?: unknown
    agent_id?: string | null
    session_key?: string | null
    raw_output?: unknown
    started_at?: string | null
    completed_at?: string | null
    duration_seconds?: number
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    llm_calls?: number
    failed_calls?: number
    latency_ms?: number
    error?: string | null
}

export interface TradingDecision {
    action: 'BUY' | 'SELL' | 'HOLD'
    confidence: number
    position_size?: number
    reasoning?: Record<string, unknown>
    raw_decision?: Record<string, unknown>
}

export interface AnalysisTask {
    id: number
    task_id: string
    ticker: string
    market?: MarketMode
    analysis_date: string
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
    execution_mode: 'default' | 'openclaw'
    decision?: TradingDecision
    stages?: AnalysisStage[]
    analysis_report?: Record<string, unknown>
    error?: string
    completed_at?: string
    processing_time_seconds?: number
    llm_provider?: string
    llm_model?: string
    llm_base_url?: string
    created_at: string
    updated_at: string
}

export interface AnalysisStats {
    total_analyses: number
    completed: number
    failed: number
    pending: number
    decisions: {
        buy: number
        sell: number
        hold: number
    }
}

export interface TradingServiceHealth {
    status: string
    trading_service: Record<string, unknown>
}

export interface OHLCVPoint {
    date: string
    open: number
    high: number
    low: number
    close: number
    volume: number
}

export type TerminalPeriod = 'day' | 'week' | 'month'

export interface IndicatorPoint {
    date: string
    value: number
}

export interface ChartTerminalCapabilities {
    chart: boolean
    intraday: boolean
    ma: boolean
    macd: boolean
    notices: boolean
    terminal_sidebar: boolean
    quote_polling: boolean
}

export interface ChartTerminalNotice {
    title: string
    date: string
    type?: string | null
    source: string
    url?: string | null
}

export interface ChartTerminalMetric {
    label: string
    value: string
}

export interface ChartDebugMeta {
    source: string
    fallback_used?: string | null
    cache_status: string
    stale: boolean
    fetched_at: string
}

export interface ChartSeriesResponse extends ChartDebugMeta {
    ticker: string
    market?: MarketMode
    range: string
    data: OHLCVPoint[]
}

export interface ChartTerminalResponse extends ChartDebugMeta {
    ticker: string
    market: MarketMode
    name: string
    period: TerminalPeriod
    updated_at: string
    chart: OHLCVPoint[]
    indicators: {
        ma: {
            ma5: IndicatorPoint[]
            ma10: IndicatorPoint[]
            ma20: IndicatorPoint[]
            ma60: IndicatorPoint[]
        }
        macd: {
            dif: IndicatorPoint[]
            dea: IndicatorPoint[]
            hist: IndicatorPoint[]
        }
    }
    sidebar: {
        metrics: ChartTerminalMetric[]
        notices: ChartTerminalNotice[]
    }
    capabilities: ChartTerminalCapabilities
    partial: boolean
    has_more_left: boolean
    oldest_date?: string | null
    newest_date?: string | null
}

export interface ChartQuoteResponse extends ChartDebugMeta {
    ticker: string
    market: MarketMode
    name: string
    updated_at: string
    last_price?: number | null
    change?: number | null
    change_pct?: number | null
    open?: number | null
    high?: number | null
    low?: number | null
    prev_close?: number | null
    volume?: number | null
    amount?: number | null
    turnover_rate?: number | null
}

export interface OllamaModel {
    name: string
    modified_at?: string
    size?: number
}

/** Events emitted by the SSE stream endpoint */
export interface StreamEvent {
    type:
        | 'token'
        | 'stage_end'
        | 'analyst_start'
        | 'analyst_status'
        | 'tool_start'
        | 'tool_end'
        | 'partial'
        | 'analyst_complete'
        | 'analyst_error'
        | 'task_complete'
        | 'task_error'
        | 'error'
    /** Stage identifier (market, social, news, etc.) */
    stage_id?: string
    /** LangGraph node name */
    node?: string
    /** Token text (for type=token) */
    t?: string
    text?: string
    /** JSON-serialised StageResult for type=stage_end */
    data?: string
    /** Task status for type=task_complete */
    status?: string
    /** Error message */
    error?: string
    summary?: string
    tool?: string
    ts?: string
    seq?: string
}

class TradingService {
    private getAuthHeaders(): HeadersInit {
        const token = localStorage.getItem(TOKEN_STORAGE_KEY)
        return {
            'Content-Type': 'application/json',
            'Authorization': withBearerToken(token),
        }
    }

    async requestAnalysis(
        ticker: string,
        market: MarketMode,
        date: string,
        llmConfig?: AnalysisRequest['llm_config'],
        executionMode: AnalysisRequest['execution_mode'] = 'default',
    ): Promise<AnalysisTask> {
        const response = await fetch(`${API_BASE_URL}/api/trading/analyze`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({ ticker, market, date, execution_mode: executionMode, llm_config: llmConfig }),
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Failed to start analysis' }))
            throw new Error(error.error || 'Failed to start analysis')
        }

        return response.json()
    }

    async getAnalysisResult(taskId: string): Promise<AnalysisTask> {
        const response = await fetch(`${API_BASE_URL}/api/trading/analysis/${taskId}`, {
            headers: this.getAuthHeaders(),
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Failed to fetch result' }))
            throw new Error(error.error || 'Failed to fetch result')
        }

        return response.json()
    }

    async cancelAnalysis(taskId: string): Promise<AnalysisTask> {
        const response = await fetch(`${API_BASE_URL}/api/trading/analysis/${taskId}/cancel`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Failed to cancel analysis' }))
            throw new Error(error.error || 'Failed to cancel analysis')
        }

        return response.json()
    }

    async resumeAnalysis(taskId: string): Promise<AnalysisTask> {
        const response = await fetch(`${API_BASE_URL}/api/trading/analysis/${taskId}/resume`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Failed to resume analysis' }))
            throw new Error(error.error || 'Failed to resume analysis')
        }

        return response.json()
    }

    async listAnalyses(): Promise<{ tasks: AnalysisTask[]; total: number }> {
        const response = await fetch(`${API_BASE_URL}/api/trading/analyses`, {
            headers: this.getAuthHeaders(),
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Failed to fetch analyses' }))
            throw new Error(error.error || 'Failed to fetch analyses')
        }

        return response.json()
    }

    async getStats(): Promise<AnalysisStats> {
        const response = await fetch(`${API_BASE_URL}/api/trading/stats`, {
            headers: this.getAuthHeaders(),
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Failed to fetch stats' }))
            throw new Error(error.error || 'Failed to fetch stats')
        }

        return response.json()
    }

    async checkHealth(): Promise<TradingServiceHealth> {
        const response = await fetch(`${API_BASE_URL}/api/trading/health`, {
            headers: this.getAuthHeaders(),
        })

        if (!response.ok) {
            throw new Error('Trading service is unavailable')
        }

        return response.json()
    }

    // Poll for analysis result until completed or failed
    async pollAnalysisResult(
        taskId: string,
        onProgress?: (task: AnalysisTask) => void,
        maxAttempts = 60,
        intervalMs = 5000
    ): Promise<AnalysisTask> {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const task = await this.getAnalysisResult(taskId)

            if (onProgress) {
                onProgress(task)
            }

            if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
                return task
            }

            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, intervalMs))
        }

        throw new Error('Analysis timeout - please check status manually')
    }

    async getStockChart(ticker: string, range: string = '3m', market: MarketMode = 'us'): Promise<ChartSeriesResponse> {
        const response = await fetch(`${API_BASE_URL}/api/trading/chart/${encodeURIComponent(ticker)}?range=${range}&market=${market}`, {
            headers: this.getAuthHeaders(),
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Failed to fetch chart data' }))
            throw new Error(error.error || 'Failed to fetch chart data')
        }

        return response.json()
    }

    async getTerminal(ticker: string, market: MarketMode, period: TerminalPeriod, before?: string): Promise<ChartTerminalResponse> {
        const params = new URLSearchParams({ market, period })
        if (before) {
            params.set('before', before)
        }
        const response = await fetch(`${API_BASE_URL}/api/trading/terminal/${encodeURIComponent(ticker)}?${params.toString()}`, {
            headers: this.getAuthHeaders(),
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Failed to fetch terminal data' }))
            throw new Error(error.error || 'Failed to fetch terminal data')
        }

        return response.json()
    }

    async getQuote(ticker: string, market: MarketMode): Promise<ChartQuoteResponse> {
        const response = await fetch(`${API_BASE_URL}/api/trading/quote/${encodeURIComponent(ticker)}?market=${market}`, {
            headers: this.getAuthHeaders(),
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Failed to fetch quote data' }))
            throw new Error(error.error || 'Failed to fetch quote data')
        }

        return response.json()
    }

    async getOllamaModels(baseUrl: string): Promise<{ base_url: string; models: OllamaModel[] }> {
        const url = new URL(`${API_BASE_URL}/api/trading/ollama/models`)
        if (baseUrl.trim()) {
            url.searchParams.set('base_url', baseUrl.trim())
        }

        const response = await fetch(url.toString(), {
            headers: this.getAuthHeaders(),
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Failed to detect Ollama models' }))
            throw new Error(error.error || 'Failed to detect Ollama models')
        }

        return response.json()
    }

    /** Return the raw JWT token string (without Bearer prefix) for use in EventSource URLs */
    getAuthToken(): string | null {
        return localStorage.getItem(TOKEN_STORAGE_KEY)
    }

    /**
     * Open an SSE stream for a task. Returns a cleanup function.
     *
     * NOTE: Browser's native EventSource cannot set custom headers,
     * so we pass the JWT via ?token= query param. The Go AuthMiddleware
     * accepts this fallback.
     */
    streamAnalysis(
        taskId: string,
        onEvent: (event: StreamEvent) => void,
        token: string,
    ): () => void {
        const url = `${API_BASE_URL}/api/trading/analysis/${taskId}/stream?token=${encodeURIComponent(token)}`
        const es = new EventSource(url)

        es.onmessage = (msg) => {
            try {
                const parsed = JSON.parse(msg.data) as StreamEvent
                onEvent(parsed)
            } catch {
                // ignore malformed frames
            }
        }

        es.onerror = () => {
            es.close()
        }

        return () => es.close()
    }
}

export const tradingService = new TradingService()
