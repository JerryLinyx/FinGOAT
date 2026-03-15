import { useState, useCallback, useRef, useEffect } from 'react'
import { createChart, CandlestickSeries, HistogramSeries } from 'lightweight-charts'
import type { IChartApi } from 'lightweight-charts'
import { tradingService } from '../services/tradingService'
import type { OHLCVPoint } from '../services/tradingService'
import '../ChartPage.css'

const VIEW_OPTIONS = [
    { id: '1d', label: '1D', range: '3m', barLabel: 'daily bars', windowLabel: '3M window' },
    { id: '1w', label: '1W', range: '1y', barLabel: 'weekly bars', windowLabel: '1Y window' },
    { id: '1m', label: '1M', range: '5y', barLabel: 'monthly bars', windowLabel: '5Y window' },
] as const

type ViewOption = typeof VIEW_OPTIONS[number]
type ViewOptionId = ViewOption['id']

const getViewOption = (id: ViewOptionId): ViewOption => {
    return VIEW_OPTIONS.find(option => option.id === id) ?? VIEW_OPTIONS[0]
}

const HISTORY_KEY = 'fingoat_chart_history'
const MAX_HISTORY = 8

function loadHistory(): string[] {
    try {
        const raw = localStorage.getItem(HISTORY_KEY)
        return raw ? JSON.parse(raw) : []
    } catch {
        return []
    }
}

function saveHistory(tickers: string[]) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(tickers))
}

function addToHistory(current: string[], ticker: string): string[] {
    const deduped = current.filter(t => t !== ticker)
    return [ticker, ...deduped].slice(0, MAX_HISTORY)
}

interface ChartPageProps {
    onSessionExpired?: () => void
}

export function ChartPage({ onSessionExpired }: ChartPageProps) {
    const [ticker, setTicker] = useState('')
    const [activeTicker, setActiveTicker] = useState('')
    const [view, setView] = useState<ViewOptionId>('1d')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [data, setData] = useState<OHLCVPoint[]>([])
    const [history, setHistory] = useState<string[]>(loadHistory)

    const chartContainerRef = useRef<HTMLDivElement>(null)
    const chartRef = useRef<IChartApi | null>(null)

    const fetchChart = useCallback(async (t: string, viewId: ViewOptionId) => {
        if (!t.trim()) return

        setLoading(true)
        setError('')
        try {
            const selectedView = getViewOption(viewId)
            const result = await tradingService.getStockChart(t.trim().toUpperCase(), selectedView.range)
            setData(result.data)
            setActiveTicker(result.ticker)

            // Update history
            setHistory(prev => {
                const updated = addToHistory(prev, result.ticker)
                saveHistory(updated)
                return updated
            })
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to load chart'
            setError(msg)
            if (msg.includes('401') || msg.includes('Session')) {
                onSessionExpired?.()
            }
        } finally {
            setLoading(false)
        }
    }, [onSessionExpired])

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (ticker.trim()) {
            fetchChart(ticker, view)
        }
    }

    const handleViewChange = (viewId: ViewOptionId) => {
        setView(viewId)
        if (activeTicker) {
            fetchChart(activeTicker, viewId)
        }
    }

    const handleHistoryClick = (t: string) => {
        setTicker(t)
        fetchChart(t, view)
    }

    const handleClearHistory = () => {
        setHistory([])
        localStorage.removeItem(HISTORY_KEY)
    }

    const selectedView = getViewOption(view)

    // Render chart when data changes
    useEffect(() => {
        if (!chartContainerRef.current || data.length === 0) return

        // Clean up previous chart
        if (chartRef.current) {
            chartRef.current.remove()
            chartRef.current = null
        }

        const container = chartContainerRef.current

        const isDark = document.documentElement.classList.contains('theme-dark') ||
            container.closest('.theme-dark') !== null

        const chart = createChart(container, {
            width: container.clientWidth,
            height: container.clientHeight,
            layout: {
                background: { color: 'transparent' },
                textColor: isDark ? '#aaa8a0' : '#6b6960',
                fontFamily: "'Inter', system-ui, sans-serif",
            },
            grid: {
                vertLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(26,26,20,0.06)' },
                horzLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(26,26,20,0.06)' },
            },
            crosshair: {
                mode: 0,
            },
            rightPriceScale: {
                borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(26,26,20,0.1)',
            },
            timeScale: {
                borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(26,26,20,0.1)',
                timeVisible: false,
            },
        })

        chartRef.current = chart

        const candleSeries = chart.addSeries(CandlestickSeries, {
            upColor: '#4caf7a',
            downColor: '#e05252',
            borderUpColor: '#4caf7a',
            borderDownColor: '#e05252',
            wickUpColor: '#4caf7a',
            wickDownColor: '#e05252',
        })

        candleSeries.setData(
            data.map(d => ({
                time: d.date,
                open: d.open,
                high: d.high,
                low: d.low,
                close: d.close,
            }))
        )

        const volumeSeries = chart.addSeries(HistogramSeries, {
            priceFormat: { type: 'volume' },
            priceScaleId: 'volume',
        })

        chart.priceScale('volume').applyOptions({
            scaleMargins: { top: 0.85, bottom: 0 },
        })

        volumeSeries.setData(
            data.map(d => ({
                time: d.date,
                value: d.volume,
                color: d.close >= d.open
                    ? 'rgba(76,175,122,0.25)'
                    : 'rgba(224,82,82,0.25)',
            }))
        )

        chart.timeScale().fitContent()

        // Resize observer
        const ro = new ResizeObserver(entries => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect
                chart.applyOptions({ width, height })
            }
        })
        ro.observe(container)

        return () => {
            ro.disconnect()
            chart.remove()
            chartRef.current = null
        }
    }, [data])

    return (
        <div className="chart-page">
            <form className="chart-toolbar" onSubmit={handleSubmit}>
                <div className="chart-ticker-group">
                    <input
                        type="text"
                        className="chart-ticker-input"
                        placeholder="Enter ticker, e.g. AAPL"
                        value={ticker}
                        onChange={e => setTicker(e.target.value.toUpperCase())}
                        disabled={loading}
                        maxLength={10}
                    />
                    <button
                        type="submit"
                        className="chart-load-btn"
                        disabled={loading || !ticker.trim()}
                    >
                        {loading ? 'Loading…' : 'Load'}
                    </button>
                </div>

                <div className="chart-range-group">
                    {VIEW_OPTIONS.map(option => (
                        <button
                            key={option.id}
                            type="button"
                            className={`chart-range-btn ${view === option.id ? 'chart-range-btn--active' : ''}`}
                            onClick={() => handleViewChange(option.id)}
                            disabled={loading}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </form>

            {/* Query history row */}
            {history.length > 0 && (
                <div className="chart-history">
                    <span className="chart-history-label">Recent</span>
                    <div className="chart-history-chips">
                        {history.map(t => (
                            <button
                                key={t}
                                type="button"
                                className={`chart-history-chip ${t === activeTicker ? 'chart-history-chip--active' : ''}`}
                                onClick={() => handleHistoryClick(t)}
                                disabled={loading}
                            >
                                {t}
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        className="chart-history-clear"
                        onClick={handleClearHistory}
                        title="Clear history"
                        aria-label="Clear search history"
                    >
                        ✕
                    </button>
                </div>
            )}

            {error && <div className="chart-error">{error}</div>}

            {activeTicker && !error && (
                <div className="chart-header">
                    <h2 className="chart-title">{activeTicker}</h2>
                    {data.length > 0 && (
                        <span className="chart-meta">{data.length} {selectedView.barLabel} · {selectedView.windowLabel}</span>
                    )}
                </div>
            )}

            <div className="chart-container" ref={chartContainerRef}>
                {data.length === 0 && !loading && !error && (
                    <div className="chart-placeholder">
                        <span className="chart-placeholder-icon">📈</span>
                        <p>Enter a stock ticker to view its K-line chart</p>
                    </div>
                )}
            </div>
        </div>
    )
}
