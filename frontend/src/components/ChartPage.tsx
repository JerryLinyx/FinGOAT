import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    CandlestickSeries,
    ColorType,
    createChart,
    CrosshairMode,
    HistogramSeries,
    LineSeries,
} from 'lightweight-charts'
import type { IChartApi } from 'lightweight-charts'
import { tradingService } from '../services/tradingService'
import type {
    ChartQuoteResponse,
    ChartTerminalCapabilities,
    ChartTerminalResponse,
    MarketMode,
    TerminalPeriod,
} from '../services/tradingService'
import '../ChartPage.css'

const PERIOD_OPTIONS = [
    { id: 'intraday', label: '分时', disabled: true },
    { id: 'day', label: '日K', disabled: false },
    { id: 'week', label: '周K', disabled: false },
    { id: 'month', label: '月K', disabled: false },
] as const

type DisplayPeriodOption = typeof PERIOD_OPTIONS[number]['id']

const HISTORY_KEY = 'fingoat_chart_history'
const MARKET_STORAGE_KEY = 'fingoat_chart_market'
const PERIOD_STORAGE_KEY = 'fingoat_chart_period'
const MAX_HISTORY = 8

interface ChartHistoryEntry {
    market: MarketMode
    ticker: string
    period: TerminalPeriod
}

interface ChartPageProps {
    onSessionExpired?: () => void
}

interface ChartBundle {
    chart: IChartApi
    series: any
    valueByDate: Map<string, number>
}

function sanitizeTickerInput(value: string, market: MarketMode): string {
    if (market === 'cn') {
        return value.replace(/\D/g, '').slice(0, 6)
    }
    return value.toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 10)
}

function loadHistory(): ChartHistoryEntry[] {
    try {
        const raw = localStorage.getItem(HISTORY_KEY)
        if (!raw) return []
        const parsed = JSON.parse(raw) as Array<string | Partial<ChartHistoryEntry>>
        return parsed
            .map((entry) => {
                if (typeof entry === 'string') {
                    return { market: 'us' as const, ticker: entry, period: 'day' as const }
                }
                if (!entry || typeof entry.ticker !== 'string') return null
                return {
                    market: entry.market === 'cn' ? 'cn' : 'us',
                    ticker: entry.ticker,
                    period: entry.period === 'week' || entry.period === 'month' ? entry.period : 'day',
                }
            })
            .filter((entry): entry is ChartHistoryEntry => Boolean(entry))
    } catch {
        return []
    }
}

function loadMarket(): MarketMode {
    return localStorage.getItem(MARKET_STORAGE_KEY) === 'cn' ? 'cn' : 'us'
}

function loadPeriod(): TerminalPeriod {
    const value = localStorage.getItem(PERIOD_STORAGE_KEY)
    return value === 'week' || value === 'month' ? value : 'day'
}

function saveHistory(history: ChartHistoryEntry[]) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
}

function addToHistory(current: ChartHistoryEntry[], market: MarketMode, ticker: string, period: TerminalPeriod): ChartHistoryEntry[] {
    const deduped = current.filter(entry => !(entry.market === market && entry.ticker === ticker))
    return [{ market, ticker, period }, ...deduped].slice(0, MAX_HISTORY)
}

function normalizeTimeKey(time: unknown): string | null {
    if (!time) return null
    if (typeof time === 'string') return time
    if (typeof time === 'number') return String(time)
    if (typeof time === 'object' && time !== null && 'year' in (time as Record<string, unknown>)) {
        const value = time as { year: number; month: number; day: number }
        return `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`
    }
    return null
}

function formatQuoteValue(value?: number | null, digits = 2): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '--'
    return value.toLocaleString('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    })
}

function formatSignedValue(value?: number | null, digits = 2, suffix = ''): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '--'
    const sign = value > 0 ? '+' : ''
    return `${sign}${value.toLocaleString('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    })}${suffix}`
}

function formatCompactNumber(value?: number | null): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '--'
    return new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: 2,
    }).format(value)
}

function quoteTone(quote?: ChartQuoteResponse | null): 'up' | 'down' | 'flat' {
    if ((quote?.change ?? 0) > 0) return 'up'
    if ((quote?.change ?? 0) < 0) return 'down'
    return 'flat'
}

function buildValueMap(points: Array<{ date: string; value?: number; close?: number; volume?: number }>, key: 'value' | 'close' | 'volume'): Map<string, number> {
    const map = new Map<string, number>()
    for (const point of points) {
        const raw = point[key]
        if (typeof raw === 'number' && Number.isFinite(raw)) {
            map.set(point.date, raw)
        }
    }
    return map
}

function getLayoutColors() {
    const root = getComputedStyle(document.documentElement)
    const getVar = (name: string, fallback: string) => root.getPropertyValue(name).trim() || fallback
    return {
        bg: getVar('--panel-bg', '#faf8f2'),
        surface: getVar('--surface-soft', '#f1ede4'),
        border: getVar('--panel-border', 'rgba(26,26,20,0.08)'),
        text: getVar('--text-primary', '#191713'),
        muted: getVar('--text-secondary', '#6f6b5f'),
        green: '#cc3d4b',
        red: '#2f9d63',
        grid: 'rgba(106, 100, 87, 0.12)',
    }
}

export function ChartPage({ onSessionExpired }: ChartPageProps) {
    const [ticker, setTicker] = useState('')
    const [activeTicker, setActiveTicker] = useState('')
    const [market, setMarket] = useState<MarketMode>(loadMarket)
    const [period, setPeriod] = useState<TerminalPeriod>(loadPeriod)
    const [loading, setLoading] = useState(false)
    const [quoteRefreshing, setQuoteRefreshing] = useState(false)
    const [error, setError] = useState('')
    const [terminal, setTerminal] = useState<ChartTerminalResponse | null>(null)
    const [quote, setQuote] = useState<ChartQuoteResponse | null>(null)
    const [history, setHistory] = useState<ChartHistoryEntry[]>(loadHistory)

    const mainChartContainerRef = useRef<HTMLDivElement>(null)
    const volumeChartContainerRef = useRef<HTMLDivElement>(null)
    const macdChartContainerRef = useRef<HTMLDivElement>(null)
    const chartBundlesRef = useRef<Partial<Record<'main' | 'volume' | 'macd', ChartBundle>>>({})
    const syncingRangeRef = useRef(false)
    const syncingCrosshairRef = useRef(false)

    const capabilities: ChartTerminalCapabilities | null = terminal?.capabilities ?? null
    const chartPoints = terminal?.chart ?? []
    const activePeriodLabel = useMemo(() => PERIOD_OPTIONS.find(option => option.id === period)?.label ?? '日K', [period])
    const tone = quoteTone(quote)

    const fetchQuote = useCallback(async (tickerValue: string, marketValue: MarketMode, markLoading = false) => {
        if (!tickerValue.trim()) return
        if (markLoading) setQuoteRefreshing(true)
        try {
            const payload = await tradingService.getQuote(tickerValue, marketValue)
            setQuote(payload)
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to refresh quote'
            if (message.includes('401') || message.includes('Session')) {
                onSessionExpired?.()
            }
            if (markLoading) {
                setError(message)
            }
        } finally {
            if (markLoading) setQuoteRefreshing(false)
        }
    }, [onSessionExpired])

    const fetchTerminal = useCallback(async (rawTicker: string, nextPeriod: TerminalPeriod, nextMarket: MarketMode = market) => {
        const formattedTicker = sanitizeTickerInput(rawTicker.trim(), nextMarket)
        if (!formattedTicker) return

        setLoading(true)
        setError('')
        try {
            const [terminalResult, quoteResult] = await Promise.all([
                tradingService.getTerminal(formattedTicker, nextMarket, nextPeriod),
                tradingService.getQuote(formattedTicker, nextMarket).catch(() => null),
            ])
            setTerminal(terminalResult)
            setQuote(quoteResult)
            setActiveTicker(terminalResult.ticker)
            setTicker(terminalResult.ticker)

            setHistory(prev => {
                const updated = addToHistory(prev, nextMarket, terminalResult.ticker, nextPeriod)
                saveHistory(updated)
                return updated
            })
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to load terminal'
            setError(message)
            if (message.includes('401') || message.includes('Session')) {
                onSessionExpired?.()
            }
        } finally {
            setLoading(false)
        }
    }, [market, onSessionExpired])

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault()
        if (ticker.trim()) {
            fetchTerminal(ticker, period, market)
        }
    }

    const handlePeriodChange = (nextPeriod: DisplayPeriodOption) => {
        if (nextPeriod === 'intraday') return
        setPeriod(nextPeriod)
        localStorage.setItem(PERIOD_STORAGE_KEY, nextPeriod)
        if (activeTicker) {
            fetchTerminal(activeTicker, nextPeriod, market)
        }
    }

    const handleHistoryClick = (entry: ChartHistoryEntry) => {
        setMarket(entry.market)
        setPeriod(entry.period)
        localStorage.setItem(MARKET_STORAGE_KEY, entry.market)
        localStorage.setItem(PERIOD_STORAGE_KEY, entry.period)
        setTicker(entry.ticker)
        fetchTerminal(entry.ticker, entry.period, entry.market)
    }

    const handleClearHistory = () => {
        setHistory([])
        localStorage.removeItem(HISTORY_KEY)
    }

    const handleMarketChange = (nextMarket: MarketMode) => {
        setMarket(nextMarket)
        localStorage.setItem(MARKET_STORAGE_KEY, nextMarket)
        setTicker(prev => sanitizeTickerInput(prev, nextMarket))
        setActiveTicker('')
        setTerminal(null)
        setQuote(null)
        setError('')
    }

    useEffect(() => {
        if (!activeTicker || !capabilities?.quote_polling || market !== 'cn') {
            return
        }

        let cancelled = false
        let intervalId: number | null = null

        const sync = async () => {
            if (document.visibilityState !== 'visible' || cancelled) return
            await fetchQuote(activeTicker, market, false)
        }

        const start = () => {
            if (intervalId !== null) return
            intervalId = window.setInterval(sync, 15000)
        }

        const stop = () => {
            if (intervalId !== null) {
                window.clearInterval(intervalId)
                intervalId = null
            }
        }

        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                sync()
                start()
            } else {
                stop()
            }
        }

        handleVisibility()
        document.addEventListener('visibilitychange', handleVisibility)

        return () => {
            cancelled = true
            stop()
            document.removeEventListener('visibilitychange', handleVisibility)
        }
    }, [activeTicker, capabilities?.quote_polling, fetchQuote, market])

    useEffect(() => {
        const mainContainer = mainChartContainerRef.current
        const volumeContainer = volumeChartContainerRef.current
        const macdContainer = macdChartContainerRef.current

        if (!mainContainer || !volumeContainer || !macdContainer) return
        if (chartPoints.length === 0) {
            chartBundlesRef.current = {}
            return
        }

        const colors = getLayoutColors()

        const createBaseChart = (container: HTMLDivElement, showTime = false) => createChart(container, {
            width: container.clientWidth,
            height: container.clientHeight,
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: colors.muted,
                fontFamily: "'Inter', system-ui, sans-serif",
                fontSize: 11,
            },
            grid: {
                vertLines: { color: colors.grid },
                horzLines: { color: colors.grid },
            },
            crosshair: {
                mode: CrosshairMode.Normal,
                vertLine: { color: 'rgba(29, 27, 22, 0.24)', width: 1, style: 2, labelBackgroundColor: colors.text },
                horzLine: { color: 'rgba(29, 27, 22, 0.18)', width: 1, style: 2, labelBackgroundColor: colors.text },
            },
            rightPriceScale: {
                borderColor: colors.border,
                scaleMargins: showTime ? { top: 0.08, bottom: 0.12 } : { top: 0.08, bottom: 0.08 },
            },
            timeScale: {
                borderColor: colors.border,
                timeVisible: showTime,
                secondsVisible: false,
            },
            localization: {
                locale: 'zh-CN',
            },
        })

        const mainChart = createBaseChart(mainContainer, false)
        const volumeChart = createBaseChart(volumeContainer, false)
        const macdChart = createBaseChart(macdContainer, true)

        const candleSeries = mainChart.addSeries(CandlestickSeries, {
            upColor: colors.red,
            downColor: colors.green,
            borderVisible: true,
            borderUpColor: colors.red,
            borderDownColor: colors.green,
            wickUpColor: colors.red,
            wickDownColor: colors.green,
            priceLineVisible: false,
            lastValueVisible: true,
        })
        candleSeries.setData(chartPoints.map(point => ({
            time: point.date,
            open: point.open,
            high: point.high,
            low: point.low,
            close: point.close,
        })))

        if (capabilities?.ma) {
            const maPalette: Array<[keyof ChartTerminalResponse['indicators']['ma'], string]> = [
                ['ma5', '#e07126'],
                ['ma10', '#3a8ee6'],
                ['ma20', '#8d5cf6'],
                ['ma60', '#2f9d63'],
            ]

            maPalette.forEach(([key, color]) => {
                const series = mainChart.addSeries(LineSeries, {
                    color,
                    lineWidth: 2,
                    priceLineVisible: false,
                    lastValueVisible: false,
                })
                series.setData((terminal?.indicators.ma[key] ?? []).map(point => ({
                    time: point.date,
                    value: point.value,
                })))
            })
        }

        const volumeSeries = volumeChart.addSeries(HistogramSeries, {
            color: colors.red,
            priceFormat: { type: 'volume' },
            priceLineVisible: false,
            lastValueVisible: false,
        })
        volumeSeries.setData(chartPoints.map(point => ({
            time: point.date,
            value: point.volume,
            color: point.close >= point.open ? 'rgba(204, 61, 75, 0.72)' : 'rgba(47, 157, 99, 0.72)',
        })))

        let macdPrimarySeries: any = null
        if (capabilities?.macd) {
            const histSeries = macdChart.addSeries(HistogramSeries, {
                priceLineVisible: false,
                lastValueVisible: false,
            })
            histSeries.setData((terminal?.indicators.macd.hist ?? []).map(point => ({
                time: point.date,
                value: point.value,
                color: point.value >= 0 ? 'rgba(204, 61, 75, 0.78)' : 'rgba(47, 157, 99, 0.78)',
            })))

            const difSeries = macdChart.addSeries(LineSeries, {
                color: '#ffb54b',
                lineWidth: 2,
                priceLineVisible: false,
                lastValueVisible: false,
            })
            difSeries.setData((terminal?.indicators.macd.dif ?? []).map(point => ({
                time: point.date,
                value: point.value,
            })))

            const deaSeries = macdChart.addSeries(LineSeries, {
                color: '#3a8ee6',
                lineWidth: 2,
                priceLineVisible: false,
                lastValueVisible: false,
            })
            deaSeries.setData((terminal?.indicators.macd.dea ?? []).map(point => ({
                time: point.date,
                value: point.value,
            })))

            macdPrimarySeries = histSeries
        }

        const bundles: Partial<Record<'main' | 'volume' | 'macd', ChartBundle>> = {
            main: {
                chart: mainChart,
                series: candleSeries,
                valueByDate: buildValueMap(chartPoints, 'close'),
            },
            volume: {
                chart: volumeChart,
                series: volumeSeries,
                valueByDate: buildValueMap(chartPoints, 'volume'),
            },
        }

        if (macdPrimarySeries) {
            bundles.macd = {
                chart: macdChart,
                series: macdPrimarySeries,
                valueByDate: buildValueMap((terminal?.indicators.macd.hist ?? []).map(point => ({
                    date: point.date,
                    value: point.value,
                })), 'value'),
            }
        }

        chartBundlesRef.current = bundles

        const syncVisibleRange = (source: keyof typeof bundles, range: unknown) => {
            if (!range || syncingRangeRef.current) return
            syncingRangeRef.current = true
            ;(Object.entries(chartBundlesRef.current) as Array<[keyof typeof bundles, ChartBundle | undefined]>).forEach(([key, bundle]) => {
                if (!bundle || key === source) return
                bundle.chart.timeScale().setVisibleLogicalRange(range as never)
            })
            syncingRangeRef.current = false
        }

        const syncCrosshair = (source: keyof typeof bundles, param: any) => {
            if (syncingCrosshairRef.current) return
            syncingCrosshairRef.current = true
            const timeKey = normalizeTimeKey(param?.time)
            ;(Object.entries(chartBundlesRef.current) as Array<[keyof typeof bundles, ChartBundle | undefined]>).forEach(([key, bundle]) => {
                if (!bundle || key === source) return
                const chartAny = bundle.chart as any
                if (!timeKey || !bundle.valueByDate.has(timeKey)) {
                    chartAny.clearCrosshairPosition?.()
                    return
                }
                chartAny.setCrosshairPosition?.(bundle.valueByDate.get(timeKey), param.time, bundle.series)
            })
            syncingCrosshairRef.current = false
        }

        mainChart.timeScale().subscribeVisibleLogicalRangeChange(range => syncVisibleRange('main', range))
        volumeChart.timeScale().subscribeVisibleLogicalRangeChange(range => syncVisibleRange('volume', range))
        macdChart.timeScale().subscribeVisibleLogicalRangeChange(range => syncVisibleRange('macd', range))

        mainChart.subscribeCrosshairMove(param => syncCrosshair('main', param))
        volumeChart.subscribeCrosshairMove(param => syncCrosshair('volume', param))
        macdChart.subscribeCrosshairMove(param => syncCrosshair('macd', param))

        mainChart.timeScale().fitContent()
        volumeChart.timeScale().fitContent()
        macdChart.timeScale().fitContent()

        const resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                const target = entry.target
                const width = entry.contentRect.width
                const height = entry.contentRect.height
                if (target === mainContainer) {
                    mainChart.applyOptions({ width, height })
                } else if (target === volumeContainer) {
                    volumeChart.applyOptions({ width, height })
                } else if (target === macdContainer) {
                    macdChart.applyOptions({ width, height })
                }
            }
        })

        resizeObserver.observe(mainContainer)
        resizeObserver.observe(volumeContainer)
        resizeObserver.observe(macdContainer)

        return () => {
            resizeObserver.disconnect()
            mainChart.remove()
            volumeChart.remove()
            macdChart.remove()
            chartBundlesRef.current = {}
        }
    }, [capabilities?.ma, capabilities?.macd, chartPoints, terminal])

    return (
        <div className="chart-page chart-terminal-page">
            <form className="chart-terminal-toolbar" onSubmit={handleSubmit}>
                <div className="chart-terminal-toolbar__cluster">
                    <div className="chart-market-toggle" role="tablist" aria-label="Select market">
                        <button
                            type="button"
                            className={`chart-market-btn ${market === 'us' ? 'chart-market-btn--active' : ''}`}
                            onClick={() => handleMarketChange('us')}
                            disabled={loading}
                        >
                            US
                        </button>
                        <button
                            type="button"
                            className={`chart-market-btn ${market === 'cn' ? 'chart-market-btn--active' : ''}`}
                            onClick={() => handleMarketChange('cn')}
                            disabled={loading}
                        >
                            A股
                        </button>
                    </div>
                    <input
                        type="text"
                        className="chart-ticker-input chart-terminal-toolbar__ticker"
                        placeholder={market === 'cn' ? '输入 A 股代码，例如 600519' : 'Enter ticker, e.g. AAPL'}
                        value={ticker}
                        onChange={event => setTicker(sanitizeTickerInput(event.target.value, market))}
                        disabled={loading}
                        maxLength={market === 'cn' ? 6 : 10}
                    />
                    <button
                        type="submit"
                        className="chart-load-btn"
                        disabled={loading || !ticker.trim()}
                    >
                        {loading ? '载入中…' : '打开终端'}
                    </button>
                </div>

                <div className="chart-terminal-periods" role="tablist" aria-label="Select chart period">
                    {PERIOD_OPTIONS.map(option => (
                        <button
                            key={option.id}
                            type="button"
                            className={`chart-terminal-period ${period === option.id ? 'chart-terminal-period--active' : ''}`}
                            onClick={() => handlePeriodChange(option.id)}
                            disabled={loading || option.disabled}
                            title={option.disabled ? '分时将在后续版本开放' : undefined}
                        >
                            {option.label}
                            {option.disabled && <span className="chart-terminal-period__badge">Soon</span>}
                        </button>
                    ))}
                </div>
            </form>

            {history.length > 0 && (
                <div className="chart-history chart-terminal-history">
                    <span className="chart-history-label">Recent</span>
                    <div className="chart-history-chips">
                        {history.map(entry => (
                            <button
                                key={`${entry.market}:${entry.ticker}:${entry.period}`}
                                type="button"
                                className={`chart-history-chip ${entry.ticker === activeTicker && entry.market === market ? 'chart-history-chip--active' : ''}`}
                                onClick={() => handleHistoryClick(entry)}
                                disabled={loading}
                            >
                                <span>{entry.ticker}</span>
                                <span className="chart-history-chip__market">{entry.market === 'cn' ? 'A股' : 'US'} · {entry.period.toUpperCase()}</span>
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

            {!terminal && !loading && !error && (
                <div className="chart-terminal-empty">
                    <div className="chart-terminal-empty__icon">⌁</div>
                    <h2>Professional Chart Terminal</h2>
                    <p>{market === 'cn' ? '输入 6 位 A 股代码，进入专业盘布局。' : 'Enter a US ticker to open the terminal layout.'}</p>
                </div>
            )}

            {terminal && (
                <>
                    <section className={`chart-terminal-quote chart-terminal-quote--${tone}`}>
                        <div className="chart-terminal-quote__identity">
                            <div className="chart-terminal-quote__eyebrow">{market === 'cn' ? 'A-share Terminal' : 'US Chart Terminal'}</div>
                            <div className="chart-terminal-quote__title">
                                <h2>{quote?.name || terminal.name}</h2>
                                <span>{activeTicker}</span>
                                <span className="chart-market-tag">{market === 'cn' ? 'A股' : 'US'}</span>
                            </div>
                            <div className="chart-terminal-quote__caption">
                                {activePeriodLabel} · {quoteRefreshing ? 'refreshing…' : 'live board'}
                            </div>
                        </div>
                        <div className="chart-terminal-quote__price">
                            <strong>{formatQuoteValue(quote?.last_price)}</strong>
                            <span>{formatSignedValue(quote?.change)}</span>
                            <span>{formatSignedValue(quote?.change_pct, 2, '%')}</span>
                        </div>
                        <div className="chart-terminal-quote__grid">
                            <div>
                                <span>Open</span>
                                <strong>{formatQuoteValue(quote?.open)}</strong>
                            </div>
                            <div>
                                <span>High</span>
                                <strong>{formatQuoteValue(quote?.high)}</strong>
                            </div>
                            <div>
                                <span>Low</span>
                                <strong>{formatQuoteValue(quote?.low)}</strong>
                            </div>
                            <div>
                                <span>Prev Close</span>
                                <strong>{formatQuoteValue(quote?.prev_close)}</strong>
                            </div>
                            <div>
                                <span>Volume</span>
                                <strong>{formatCompactNumber(quote?.volume)}</strong>
                            </div>
                            <div>
                                <span>Turnover</span>
                                <strong>{quote?.turnover_rate != null ? `${formatQuoteValue(quote.turnover_rate)}%` : '--'}</strong>
                            </div>
                        </div>
                    </section>

                    <div className="chart-terminal-shell">
                        <section className="chart-terminal-board">
                            <header className="chart-terminal-board__header">
                                <div>
                                    <h3>{terminal.name} Terminal</h3>
                                    <p>{chartPoints.length} bars · {activePeriodLabel} · updated {new Date(terminal.updated_at).toLocaleString()}</p>
                                </div>
                                {terminal.partial && <span className="chart-terminal-board__flag">Partial data</span>}
                            </header>

                            <div className="chart-terminal-panels">
                                <div className="chart-terminal-panel chart-terminal-panel--main">
                                    <div className="chart-terminal-panel__label">Price / MA</div>
                                    <div className="chart-terminal-panel__canvas" ref={mainChartContainerRef} />
                                </div>
                                <div className="chart-terminal-panel chart-terminal-panel--volume">
                                    <div className="chart-terminal-panel__label">Volume</div>
                                    <div className="chart-terminal-panel__canvas" ref={volumeChartContainerRef} />
                                </div>
                                <div className={`chart-terminal-panel chart-terminal-panel--macd ${!capabilities?.macd ? 'chart-terminal-panel--muted' : ''}`}>
                                    <div className="chart-terminal-panel__label">MACD</div>
                                    <div className="chart-terminal-panel__canvas" ref={macdChartContainerRef} />
                                    {!capabilities?.macd && (
                                        <div className="chart-terminal-panel__overlay">
                                            <span>MACD is not available on the current market feed.</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </section>

                        <aside className="chart-terminal-sidebar">
                            <section className="chart-terminal-sidebar__section">
                                <div className="chart-terminal-sidebar__header">
                                    <h4>Quote Metrics</h4>
                                    <span>{capabilities?.terminal_sidebar ? 'A-share profile' : 'base feed only'}</span>
                                </div>
                                {terminal.sidebar.metrics.length > 0 ? (
                                    <div className="chart-terminal-metrics">
                                        {terminal.sidebar.metrics.map(metric => (
                                            <div key={metric.label} className="chart-terminal-metric">
                                                <span>{metric.label}</span>
                                                <strong>{metric.value}</strong>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="chart-terminal-sidebar__empty">Advanced sidebar metrics are not available on this market feed.</div>
                                )}
                            </section>

                            <section className="chart-terminal-sidebar__section">
                                <div className="chart-terminal-sidebar__header">
                                    <h4>Latest Notices</h4>
                                    <span>{terminal.sidebar.notices.length} items</span>
                                </div>
                                {terminal.sidebar.notices.length > 0 ? (
                                    <div className="chart-terminal-notices">
                                        {terminal.sidebar.notices.map((notice, index) => (
                                            <a
                                                key={`${notice.title}-${index}`}
                                                className="chart-terminal-notice"
                                                href={notice.url || undefined}
                                                target={notice.url ? '_blank' : undefined}
                                                rel={notice.url ? 'noreferrer' : undefined}
                                            >
                                                <span className="chart-terminal-notice__meta">{notice.source}{notice.type ? ` · ${notice.type}` : ''}</span>
                                                <strong>{notice.title}</strong>
                                                <span className="chart-terminal-notice__date">{notice.date}</span>
                                            </a>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="chart-terminal-sidebar__empty">No recent notices returned for the current symbol.</div>
                                )}
                            </section>
                        </aside>
                    </div>
                </>
            )}
        </div>
    )
}
