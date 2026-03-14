// Trading Analysis API Service

const rawApiUrl = import.meta.env.VITE_API_URL
const API_BASE_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : ''
const TOKEN_STORAGE_KEY = 'fingoat_token'

const withBearerToken = (token: string | null): string => {
    if (!token) return ''
    return token.startsWith('Bearer ') ? token : `Bearer ${token}`
}

export interface AnalysisRequest {
    ticker: string
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
    summary?: string | null
    content?: unknown
    agent_id?: string | null
    session_key?: string | null
    raw_output?: unknown
    started_at?: string | null
    completed_at?: string | null
    duration_seconds?: number
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
        date: string,
        llmConfig?: AnalysisRequest['llm_config'],
        executionMode: AnalysisRequest['execution_mode'] = 'default',
    ): Promise<AnalysisTask> {
        const response = await fetch(`${API_BASE_URL}/api/trading/analyze`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({ ticker, date, execution_mode: executionMode, llm_config: llmConfig }),
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

    async getStockChart(ticker: string, range: string = '3m'): Promise<{ ticker: string; range: string; data: OHLCVPoint[] }> {
        const response = await fetch(`${API_BASE_URL}/api/trading/chart/${encodeURIComponent(ticker)}?range=${range}`, {
            headers: this.getAuthHeaders(),
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Failed to fetch chart data' }))
            throw new Error(error.error || 'Failed to fetch chart data')
        }

        return response.json()
    }
}

export const tradingService = new TradingService()
