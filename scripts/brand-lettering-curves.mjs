// Smooth the owner's polygon-traced lettering without substituting a font.
// Intentional corners and open counters remain; smooth runs become cubic curves.
const minus = (a, b) => [a[0] - b[0], a[1] - b[1]]
const length = a => Math.hypot(...a)
const unit = a => { const n = length(a); return n ? a.map(v => v / n) : [0, 0] }
const dot = (a, b) => a[0] * b[0] + a[1] * b[1]
const distance = (a, b) => length(minus(a, b))
const format = n => String(Number(n.toFixed(3)))
const point = p => p.map(format).join(' ')

function simplify(points, tolerance) {
  if (points.length <= 2) return points
  const a = points[0], b = points.at(-1), v = minus(b, a), square = dot(v, v)
  let farthest = 0, split = 0
  for (let i = 1; i < points.length - 1; i++) {
    const t = square ? Math.max(0, Math.min(1, dot(minus(points[i], a), v) / square)) : 0
    const d = distance(points[i], [a[0] + t * v[0], a[1] + t * v[1]])
    if (d > farthest) { farthest = d; split = i }
  }
  if (farthest <= tolerance) return [a, b]
  return [...simplify(points.slice(0, split + 1), tolerance).slice(0, -1), ...simplify(points.slice(split), tolerance)]
}

function simplifyRing(points, tolerance) {
  let a = 0, b = 1, max = 0
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    const d = distance(points[i], points[j])
    if (d > max) { max = d; a = i; b = j }
  }
  const first = points.slice(a, b + 1)
  const second = [...points.slice(b), ...points.slice(0, a + 1)]
  return [...simplify(first, tolerance).slice(0, -1), ...simplify(second, tolerance).slice(0, -1)]
}

function smoothContour(raw) {
  if (/[^MLZ\d.\s,\-]/i.test(raw)) throw new Error('Expected original polygon lettering')
  const n = raw.match(/-?\d+(?:\.\d+)?/g).map(Number)
  let points = []
  for (let i = 0; i < n.length; i += 2) {
    const p = [n[i], n[i + 1]]
    if (!points.length || distance(points.at(-1), p) > 0) points.push(p)
  }
  if (distance(points[0], points.at(-1)) === 0) points.pop()
  const height = Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1]))
  const small = height < 55
  points = simplifyRing(points, small ? 1.05 : 1.2)
  if (points.length < 3) throw new Error('Contour collapsed')
  const vertices = points.map((p, i) => {
    const incoming = unit(minus(p, points[(i + points.length - 1) % points.length]))
    const outgoing = unit(minus(points[(i + 1) % points.length], p))
    const angle = Math.acos(Math.max(-1, Math.min(1, dot(incoming, outgoing))))
    const corner = angle > (small ? 68 : 60) * Math.PI / 180
    return { p, incoming, outgoing, corner, tangent: unit([incoming[0] + outgoing[0], incoming[1] + outgoing[1]]) }
  })
  let d = `M ${point(points[0])}`
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length]
    const v = minus(b.p, a.p), len = length(v), direction = unit(v)
    const t1 = a.corner ? direction : a.tangent
    const t2 = b.corner ? direction : b.tangent
    // Keep stems, crossbars and terminals straight, rather than bowing them.
    if ((a.corner || dot(t1, direction) > .9998) && (b.corner || dot(t2, direction) > .9998)) {
      d += ` L ${point(b.p)}`
    } else {
      const c1 = [a.p[0] + t1[0] * len / 3, a.p[1] + t1[1] * len / 3]
      const c2 = [b.p[0] - t2[0] * len / 3, b.p[1] - t2[1] * len / 3]
      d += ` C ${point(c1)} ${point(c2)} ${point(b.p)}`
    }
  }
  return `${d} Z`
}

export function smoothLettering(pathData) {
  const contours = pathData.match(/M[^M]+/g)
  if (!contours?.length) throw new Error('Missing lettering contours')
  return contours.map(smoothContour).join('\n')
}
