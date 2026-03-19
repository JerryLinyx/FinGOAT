import { useEffect, useState } from 'react'
import {
  getAdminUsageSummary,
  getAdminUserUsage,
  type AdminUsageSummary,
  type AdminUserUsage,
} from '../services/usageService'

export function AdminDashboard() {
  const [summary, setSummary] = useState<AdminUsageSummary | null>(null)
  const [users, setUsers] = useState<AdminUserUsage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([getAdminUsageSummary(), getAdminUserUsage()])
      .then(([s, u]) => {
        setSummary(s)
        setUsers(u)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="admin-dashboard"><p>Loading admin data...</p></div>
  if (error) return <div className="admin-dashboard"><p className="banner banner-error">{error}</p></div>
  if (!summary) return null

  const formatCost = (v: number) =>
    v > 0 ? `$${v.toFixed(4)}` : '$0.00'

  const formatTokens = (v: number) =>
    v >= 1_000_000
      ? `${(v / 1_000_000).toFixed(1)}M`
      : v >= 1_000
        ? `${(v / 1_000).toFixed(1)}K`
        : String(v)

  return (
    <div className="admin-dashboard">
      <h2 className="admin-dashboard__title">Admin Dashboard</h2>

      <div className="usage-kpi-grid">
        <div className="usage-kpi-card">
          <span className="usage-kpi-card__label">Total Users</span>
          <span className="usage-kpi-card__value">{summary.total_users}</span>
        </div>
        <div className="usage-kpi-card">
          <span className="usage-kpi-card__label">Total Tokens</span>
          <span className="usage-kpi-card__value">{formatTokens(summary.total_tokens)}</span>
        </div>
        <div className="usage-kpi-card">
          <span className="usage-kpi-card__label">Total Cost</span>
          <span className="usage-kpi-card__value">{formatCost(summary.total_cost)}</span>
        </div>
        <div className="usage-kpi-card">
          <span className="usage-kpi-card__label">Total Tasks</span>
          <span className="usage-kpi-card__value">{summary.total_tasks}</span>
        </div>
      </div>

      <section className="usage-section">
        <h3 className="usage-section__heading">Users</h3>
        <table className="usage-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Tokens</th>
              <th>Cost</th>
              <th>Tasks</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.user_id}>
                <td>{u.username}</td>
                <td>
                  <span className={`role-badge role-badge--${u.role}`}>{u.role}</span>
                </td>
                <td>{formatTokens(u.tokens)}</td>
                <td>{formatCost(u.cost)}</td>
                <td>{u.tasks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
