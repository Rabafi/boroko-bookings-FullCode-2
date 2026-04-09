import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

function cn(...parts) {
  return parts.filter(Boolean).join(' ')
}

export default function HorizontalScrollArea({
  children,
  className = '',
  viewportClassName = '',
  scrollAmount = 320
}) {
  const viewportRef = useRef(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const updateScrollState = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth)
    setCanScrollLeft(el.scrollLeft > 8)
    setCanScrollRight(maxScrollLeft - el.scrollLeft > 8)
  }, [])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    updateScrollState()
    const onScroll = () => updateScrollState()
    el.addEventListener('scroll', onScroll, { passive: true })

    let resizeObserver = null
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => updateScrollState())
      resizeObserver.observe(el)
      if (el.firstElementChild) resizeObserver.observe(el.firstElementChild)
    }

    const rafId = requestAnimationFrame(updateScrollState)
    window.addEventListener('resize', updateScrollState)

    return () => {
      cancelAnimationFrame(rafId)
      el.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', updateScrollState)
      resizeObserver?.disconnect()
    }
  }, [children, updateScrollState])

  const scrollByAmount = (direction) => {
    const el = viewportRef.current
    if (!el) return
    el.scrollBy({ left: direction * scrollAmount, behavior: 'smooth' })
  }

  return (
    <div className={cn('bb-scroll-area', className)}>
      <div ref={viewportRef} className={cn('bb-scroll-area__viewport', viewportClassName)}>
        {children}
      </div>

      {canScrollLeft && (
        <>
          <div className="bb-scroll-area__edge bb-scroll-area__edge--left" />
          <button
            type="button"
            className="bb-scroll-area__button bb-scroll-area__button--left"
            onClick={() => scrollByAmount(-1)}
            aria-label="Scroll table left"
            title="Scroll left"
          >
            <ChevronLeft size={18} />
          </button>
        </>
      )}

      {canScrollRight && (
        <>
          <div className="bb-scroll-area__edge bb-scroll-area__edge--right" />
          <button
            type="button"
            className="bb-scroll-area__button bb-scroll-area__button--right"
            onClick={() => scrollByAmount(1)}
            aria-label="Scroll table right"
            title="Scroll right"
          >
            <ChevronRight size={18} />
          </button>
        </>
      )}
    </div>
  )
}
