import { useState } from 'react'

const PAGE_SIZE = 25

export default function Pagination({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) return null
  const pages = []
  for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i++) pages.push(i)
  return (
    <div className="flex items-center justify-center gap-1 pt-3">
      <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page === 1}
        className="px-2 py-1 text-xs rounded bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed">←</button>
      {pages[0] > 1 && <span className="px-2 text-xs text-gray-500">…</span>}
      {pages.map(p => (
        <button key={p} onClick={() => onPageChange(p)}
          className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${p === page ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>{p}</button>
      ))}
      {pages[pages.length - 1] < totalPages && <span className="px-2 text-xs text-gray-500">…</span>}
      <button onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page === totalPages}
        className="px-2 py-1 text-xs rounded bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed">→</button>
      <span className="ml-2 text-xs text-gray-500">{page}/{totalPages}</span>
    </div>
  )
}

export function usePagination(items, pageSize = PAGE_SIZE) {
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paginated = items.slice((safePage - 1) * pageSize, safePage * pageSize)
  return { page: safePage, setPage, totalPages, paginated, total: items.length }
}
