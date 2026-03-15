/**
 * AgentFlowGraph — SVG-based DAG showing the agent graph topology and live execution state.
 *
 * Layout:
 *   Col 0 (rows 0–3): 4 parallel analyst nodes
 *   Col 1–5 (row 1.5): sequential pipeline nodes
 *
 * Edges animate and colour-code based on source/target status.
 */

import type { StageProgress, AgentStageKey } from './agentStages'

// ── Layout constants ─────────────────────────────────────────────────────────

const NW = 100   // node width
const NH = 56    // node height
const COL_GAP = 140  // horizontal distance between column centres
const ROW_GAP = 72   // vertical distance between row centres
const PAD_X = 20     // left/right padding
const PAD_Y = 16     // top/bottom padding

interface NodeLayout {
  key: AgentStageKey
  col: number
  row: number
}

const NODE_LAYOUT: NodeLayout[] = [
  // Column 0 — parallel analysts
  { key: 'market',            col: 0, row: 0 },
  { key: 'social',            col: 0, row: 1 },
  { key: 'news',              col: 0, row: 2 },
  { key: 'fundamentals',      col: 0, row: 3 },
  // Sequential pipeline
  { key: 'research_debate',   col: 1, row: 1.5 },
  { key: 'portfolio_manager', col: 2, row: 1.5 },
  { key: 'trader_plan',       col: 3, row: 1.5 },
  { key: 'risk_debate',       col: 4, row: 1.5 },
  { key: 'risk_management',   col: 5, row: 1.5 },
]

const EDGES: [AgentStageKey, AgentStageKey][] = [
  ['market',            'research_debate'],
  ['social',            'research_debate'],
  ['news',              'research_debate'],
  ['fundamentals',      'research_debate'],
  ['research_debate',   'portfolio_manager'],
  ['portfolio_manager', 'trader_plan'],
  ['trader_plan',       'risk_debate'],
  ['risk_debate',       'risk_management'],
]

// ── Geometry helpers ─────────────────────────────────────────────────────────

function nodePos(layout: NodeLayout): { cx: number; cy: number; x: number; y: number } {
  const cx = PAD_X + layout.col * COL_GAP + NW / 2
  const cy = PAD_Y + layout.row * ROW_GAP + NH / 2
  return { cx, cy, x: cx - NW / 2, y: cy - NH / 2 }
}

function edgePath(
  from: NodeLayout,
  to: NodeLayout,
): string {
  const f = nodePos(from)
  const t = nodePos(to)

  const startX = f.x + NW
  const startY = f.cy
  const endX = t.x
  const endY = t.cy

  // Cubic Bezier control points: horizontal tangents
  const cpX = (startX + endX) / 2
  return `M ${startX} ${startY} C ${cpX} ${startY}, ${cpX} ${endY}, ${endX} ${endY}`
}

// ── Edge class based on statuses ─────────────────────────────────────────────

function edgeClass(fromStatus: string, toStatus: string): string {
  if (fromStatus === 'completed' && toStatus === 'completed') return 'flow-edge flow-edge--done'
  if (fromStatus === 'completed' && toStatus === 'processing') return 'flow-edge flow-edge--active'
  if (fromStatus === 'processing' || toStatus === 'processing') return 'flow-edge flow-edge--active'
  return 'flow-edge'
}

// ── SVG canvas size ──────────────────────────────────────────────────────────

const NUM_COLS = 6
const NUM_ROWS = 4
const SVG_W = PAD_X * 2 + (NUM_COLS - 1) * COL_GAP + NW
const SVG_H = PAD_Y * 2 + (NUM_ROWS - 1) * ROW_GAP + NH

// ── Component ────────────────────────────────────────────────────────────────

interface AgentFlowGraphProps {
  stages: StageProgress[]
  selectedKey: AgentStageKey | null
  onSelectStage: (key: AgentStageKey) => void
}

export function AgentFlowGraph({ stages, selectedKey, onSelectStage }: AgentFlowGraphProps) {
  const stageByKey = Object.fromEntries(stages.map((s) => [s.key, s]))

  return (
    <svg
      className="flow-graph-svg"
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      aria-label="Agent flow graph"
    >
      {/* ── Edges ── */}
      {EDGES.map(([fromKey, toKey]) => {
        const fromLayout = NODE_LAYOUT.find((n) => n.key === fromKey)!
        const toLayout = NODE_LAYOUT.find((n) => n.key === toKey)!
        const fromStatus = stageByKey[fromKey]?.status ?? 'pending'
        const toStatus = stageByKey[toKey]?.status ?? 'pending'
        return (
          <path
            key={`${fromKey}--${toKey}`}
            d={edgePath(fromLayout, toLayout)}
            className={edgeClass(fromStatus, toStatus)}
          />
        )
      })}

      {/* ── Nodes ── */}
      {NODE_LAYOUT.map((layout) => {
        const stage = stageByKey[layout.key]
        if (!stage) return null
        const { x, y, cx } = nodePos(layout)
        const isSelected = layout.key === selectedKey

        return (
          <g
            key={layout.key}
            className={[
              'flow-node',
              `flow-node--${stage.status}`,
              isSelected ? 'flow-node--selected' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => onSelectStage(layout.key)}
            role="button"
            aria-label={`${stage.label} — ${stage.status}`}
            aria-pressed={isSelected}
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectStage(layout.key) }}
          >
            <rect x={x} y={y} width={NW} height={NH} rx={8} />

            {/* Icon */}
            <text x={cx} y={y + 16} className="flow-node__icon" textAnchor="middle" dominantBaseline="middle">
              {stage.icon}
            </text>

            {/* Label (up to 2 lines) */}
            <text x={cx} y={y + 32} className="flow-node__label" textAnchor="middle">
              {stage.label.length > 12
                ? stage.label.substring(0, 12) + '…'
                : stage.label}
            </text>

            {/* Status indicator */}
            {stage.status === 'completed' && (
              <text x={x + NW - 10} y={y + 10} className="flow-node__status-icon" textAnchor="middle" dominantBaseline="middle" fontSize="10">✓</text>
            )}
            {stage.status === 'failed' && (
              <text x={x + NW - 10} y={y + 10} className="flow-node__status-icon" textAnchor="middle" dominantBaseline="middle" fontSize="10">✕</text>
            )}

            {/* Pulse dot for processing */}
            {stage.status === 'processing' && (
              <circle className="flow-node__pulse" cx={x + NW - 8} cy={y + 8} r={4} />
            )}
          </g>
        )
      })}
    </svg>
  )
}
