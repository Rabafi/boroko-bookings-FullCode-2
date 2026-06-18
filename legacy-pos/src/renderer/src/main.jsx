import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

function installLegacyTouchFocusFix() {
  const editableSelector = 'input, textarea, select, [contenteditable="true"]';
  const activationSelector = 'button, a, summary, [role="button"], label';
  const interactiveSelector = `${editableSelector}, ${activationSelector}`;
  const scrollSelector = '.touch-scroll, .touch-scroll-y, .touch-scroll-x, [data-touch-scroll="true"]';
  let synthesizingTouchClick = false;
  let lastTouchActivationAt = 0;
  let touchStartPoint = null;

  const isEditable = (element) => element?.closest?.(editableSelector);
  const isInteractive = (element) => element?.closest?.(interactiveSelector);
  const getActivator = (element) => element?.closest?.(activationSelector);
  const getScrollRegion = (element) => element?.closest?.(scrollSelector);
  const isDisabled = (element) => Boolean(element?.disabled || element?.getAttribute?.('aria-disabled') === 'true');
  const clearSelection = () => {
    const selection = window.getSelection?.();
    if (selection && selection.type === 'Range') selection.removeAllRanges();
  };

  const focusEditableFromTouch = (event) => {
    const target = isEditable(event.target);
    if (!target || target.disabled || target.readOnly) return;
    window.requestAnimationFrame(() => {
      if (document.activeElement !== target) {
        target.focus({ preventScroll: true });
      }
    });
  };

  const preventNonControlSelection = (event) => {
    if (isInteractive(event.target)) return;
    clearSelection();
  };

  const getPoint = (event) => {
    const touch = event.changedTouches?.[0] || event.touches?.[0];
    return {
      x: Number(touch?.clientX ?? event.clientX ?? 0),
      y: Number(touch?.clientY ?? event.clientY ?? 0)
    };
  };

  const handleTouchStart = (event) => {
    touchStartPoint = getPoint(event);
    preventNonControlSelection(event);
  };

  const shouldIgnoreTouchActivation = (event) => {
    if (event.pointerType && !['touch', 'pen'].includes(event.pointerType)) return true;
    const point = getPoint(event);
    if (touchStartPoint) {
      const dx = Math.abs(point.x - touchStartPoint.x);
      const dy = Math.abs(point.y - touchStartPoint.y);
      if (dx > 8 || dy > 8) return true;
    }
    return false;
  };

  const activateControlFromTouch = (event) => {
    focusEditableFromTouch(event);
    const activator = getActivator(event.target);
    if (!activator || isDisabled(activator) || shouldIgnoreTouchActivation(event)) return;
    if (getScrollRegion(event.target) && activator !== event.target.closest('button, a, summary, [role="button"]')) return;
    if (Date.now() - lastTouchActivationAt < 280) return;
    lastTouchActivationAt = Date.now();
    event.preventDefault?.();
    clearSelection();
    window.requestAnimationFrame(() => {
      synthesizingTouchClick = true;
      try {
        activator.click();
      } finally {
        window.setTimeout(() => { synthesizingTouchClick = false; }, 0);
      }
    });
  };

  document.addEventListener('touchend', focusEditableFromTouch, { passive: true });
  document.addEventListener('pointerup', focusEditableFromTouch, { passive: true });
  document.addEventListener('MSPointerUp', focusEditableFromTouch, { passive: true });
  document.addEventListener('touchend', activateControlFromTouch, { passive: false });
  document.addEventListener('pointerup', activateControlFromTouch, { passive: false });
  document.addEventListener('MSPointerUp', activateControlFromTouch, { passive: false });
  document.addEventListener('click', (event) => {
    if (synthesizingTouchClick) return;
    if (Date.now() - lastTouchActivationAt < 500 && getActivator(event.target)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
  document.addEventListener('selectstart', (event) => {
    if (isEditable(event.target)) return;
    event.preventDefault();
  });
  document.addEventListener('dragstart', (event) => {
    if (isEditable(event.target)) return;
    event.preventDefault();
  });
  document.addEventListener('dblclick', (event) => {
    if (isEditable(event.target)) return;
    event.preventDefault();
  });
  document.addEventListener('pointerdown', preventNonControlSelection, { passive: true });
  document.addEventListener('touchstart', handleTouchStart, { passive: true });
  document.addEventListener('MSPointerDown', handleTouchStart, { passive: true });
}

installLegacyTouchFocusFix();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
