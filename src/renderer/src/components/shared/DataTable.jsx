import { ChevronUp, ChevronDown } from 'lucide-react'
import { EmptyState } from './EmptyState'

/**
 * P3-12: DataTable component with sorting and pagination
 * Provides better table UX with interactive features
 */
export function DataTable({
  columns,
  data,
  onRowClick,
  sortKey,
  sortDirection,
  onSort,
  emptyMessage = 'No data available',
  rowClassName = () => ''
}) {
  const handleSort = (key) => {
    if (onSort) {
      if (sortKey === key && sortDirection === 'asc') {
        onSort(key, 'desc')
      } else {
        onSort(key, 'asc')
      }
    }
  }

  if (!data || data.length === 0) {
    return <EmptyState title={emptyMessage} />
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                onClick={() => col.sortable && handleSort(col.key)}
                className={`px-4 py-3 text-left font-semibold text-slate-700 ${
                  col.sortable ? 'cursor-pointer hover:bg-slate-100' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  {col.label}
                  {col.sortable && sortKey === col.key && (
                    sortDirection === 'asc' ? (
                      <ChevronUp size={16} className="text-blue-600" />
                    ) : (
                      <ChevronDown size={16} className="text-blue-600" />
                    )
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => (
            <tr
              key={idx}
              onClick={() => onRowClick?.(row)}
              className={`border-b border-slate-200 hover:bg-slate-50 transition-colors ${
                onRowClick ? 'cursor-pointer' : ''
              } ${rowClassName(row)}`}
            >
              {columns.map((col) => (
                <td key={col.key} className="px-4 py-3">
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Pagination controls
 */
export function Pagination({ page, pageSize, total, onPageChange }) {
  const totalPages = Math.ceil(total / pageSize)
  const startItem = (page - 1) * pageSize + 1
  const endItem = Math.min(page * pageSize, total)

  return (
    <div className="flex items-center justify-between mt-4 px-4 py-3 border-t border-slate-200">
      <p className="text-xs text-slate-600">
        Showing <span className="font-medium">{startItem}</span> to <span className="font-medium">{endItem}</span> of <span className="font-medium">{total}</span>
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1}
          className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
        >
          Previous
        </button>
        <span className="flex items-center px-3 py-1.5 text-xs font-medium text-slate-700">
          Page {page} of {totalPages}
        </span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page === totalPages}
          className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  )
}
