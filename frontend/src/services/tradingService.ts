// Trading Analysis API Service

const API_BASE_URL = import.meta.env.VITE_API_URL?.replace(/\/$/, '') || 'http://localhost:3000'
const TOKEN_STORAGE_KEY = 'fingoat_token'

export interface AnalysisRequest {
    ticker: string
    date: string
    llm_config?: {
        provider?: string
        base_url?: string
        deep_think_llm?: string
        quick_think_llm?: string
    }
}

export interface TradingDecision {
    action: 'BUY' | 'SELL' | 'HOLD'
    confidence: number
    position_size?: number
    reasoning?: any
    raw_decision?: any
}

export interface AnalysisTask {
    ID: number
    task_id: string
    ticker: string
    analysis_date: string
    status: 'pending' | 'processing' | 'completed' | 'failed'
    decision?: TradingDecision
    analysis_report?: any
    error?: string
    completed_at?: string
    processing_time_seconds?: number
    llm_provider?: string
    llm_model?: string
    llm_base_url?: string
    CreatedAt: string
    UpdatedAt: string
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

class TradingService {
    private getAuthHeaders(): HeadersInit {
        const token = localStorage.getItem(TOKEN_STORAGE_KEY)
        return {
            'Content-Type': 'application/json',
            'Authorization': token || '',
        }
    }

    async requestAnalysis(ticker: string, date: string, llmConfig?: AnalysisRequest['llm_config']): Promise<AnalysisTask> {
        const response = await fetch(`${API_BASE_URL}/api/trading/analyze`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({ ticker, date, llm_config: llmConfig }),
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

    async checkHealth(): Promise<{ status: string; trading_service: any }> {
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

            if (task.status === 'completed' || task.status === 'failed') {
                return task
            }

            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, intervalMs))
        }

        throw new Error('Analysis timeout - please check status manually')
    }
}

export const tradingService = new TradingService()
