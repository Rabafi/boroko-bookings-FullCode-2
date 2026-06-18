import { useMemo } from 'react'

const COLORS = [
  '#a855f7', '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#06b6d4', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'
]

export function BarChart({ data, height = 160, label = '', className = '' }) {
  if (!data?.length) return null
  const max = Math.max(...data.map(d => d.value), 1)
  const barWidth = Math.min(40, Math.max(16, Math.floor(400 / data.length) - 4))

  return (
    <div className={className}>
      {label && <p className="text-xs text-gray-400 font-semibold mb-3 uppercase tracking-wider">{label}</p>}
      <div className="flex items-end gap-1" style={{ height }}>
        {data.map((d, i) => (
          <div key={i} className="flex flex-col items-center flex-1 min-w-0">
            <span className="text-[10px] text-gray-400 mb-1">{d.value}</span>
            <div
              className="rounded-t-md transition-all duration-500"
              style={{
                width: barWidth,
                height: `${Math.max(4, (d.value / max) * (height - 30))}px`,
                backgroundColor: d.color || COLORS[i % COLORS.length],
                opacity: 0.85
              }}
              title={`${d.label}: ${d.value}`}
            />
            <span className="text-[10px] text-gray-500 mt-1 truncate w-full text-center">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function DonutChart({ data, size = 120, thickness = 14, label = '', className = '' }) {
  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data])
  if (!total) return null

  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <div className={className}>
      {label && <p className="text-xs text-gray-400 font-semibold mb-3 uppercase tracking-wider">{label}</p>}
      <div className="flex items-center gap-4">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {data.map((d, i) => {
            const pct = d.value / total
            const dashLen = pct * circumference
            const currentOffset = offset
            offset += dashLen
            return (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={d.color || COLORS[i % COLORS.length]}
                strokeWidth={thickness}
                strokeDasharray={`${dashLen} ${circumference - dashLen}`}
                strokeDashoffset={-currentOffset}
                strokeLinecap="round"
                className="transition-all duration-700"
                style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
              />
            )
          })}
          <text x="50%" y="50%" textAnchor="middle" dy="0.35em" className="fill-white text-base font-bold">
            {total}
          </text>
        </svg>
        <div className="space-y-1.5 min-w-0">
          {data.map((d, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color || COLORS[i % COLORS.length] }} />
              <span className="text-gray-400 truncate">{d.label}</span>
              <span className="text-white font-medium ml-auto">{d.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function Sparkline({ data, width = 120, height = 32, color = '#a855f7', className = '' }) {
  if (!data?.length) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const padding = 2

  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1 || 1)) * (width - padding * 2)
    const y = height - padding - ((v - min) / range) * (height - padding * 2)
    return `${x},${y}`
  }).join(' ')

  const fillPoints = `${padding},${height - padding} ${points} ${width - padding},${height - padding}`

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className}>
      <polygon points={fillPoints} fill={color} fillOpacity={0.1} />
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function HorizontalBar({ label, value, max = 100, color = '#a855f7', suffix = '%', className = '' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span className="text-xs text-gray-400 w-24 truncate">{label}</span>
      <div className="flex-1 bg-gray-700 rounded-full h-2 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs text-white font-mono w-12 text-right">{value}{suffix}</span>
    </div>
  )
}
