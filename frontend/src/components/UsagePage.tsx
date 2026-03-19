import { useEffect, useState } from 'react'
import { getUserUsageSummary, type UsageSummary } from '../services/usageService'

export function UsagePage() {
  const [data, setData] = useState<UsageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getUserUsageSummary()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="usage-page"><p>Loading usage data...</p></div>
  if (error) return <div className="usage-page"><p className="banner banner-error">{error}</p></div>
  if (!data) return null

  const formatCost = (v: number) =>
    v > 0 ? `$${v.toFixed(4)}` : '$0.00'

  const formatTokens = (v: number) =>
    v >= 1_000_000
      ? `${(v / 1_000_000).toFixed(1)}M`
      : v >= 1_000
        ? `${(v / 1_000).toFixed(1)}K`
        : String(v)

  return (
    <div className="usage-page">
      <h2 className="usage-page__title">Usage</h2>

      <div className="usage-kpi-grid">
        <div className="usage-kpi-card">
          <span className="usage-kpi-card__label">Total Tokens</span>
          <span className="usage-kpi-card__value">{formatTokens(data.total_tokens)}</span>
        </div>
        <div className="usage-kpi-card">
          <span className="usage-kpi-card__label">Estimated Cost</span>
          <span className="usage-kpi-card__value">{formatCost(data.total_cost)}</span>
        </div>
        <div className="usage-kpi-card">
          <span className="usage-kpi-card__label">Total Tasks</span>
          <span className="usage-kpi-card__value">{data.total_tasks}</span>
        </div>
      </div>

      {data.by_provider && data.by_provider.length > 0 && (
        <section className="usage-section">
          <h3 className="usage-section__heading">By Provider</h3>
          <table className="usage-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Tokens</th>
                <th>Cost</th>
                <th>Tasks</th>
              </tr>
            </thead>
            <tbody>
              {data.by_provider.map((p) => (
                <tr key={p.provider}>
                  <td>{p.provider}</td>
                  <td>{formatTokens(p.tokens)}</td>
                  <td>{formatCost(p.cost)}</td>
                  <td>{p.tasks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {data.total_tasks === 0 && (
        <p className="usage-page__empty">No analysis runs yet. Run your first analysis to see usage data here.</p>
      )}
    </div>
  )
}
