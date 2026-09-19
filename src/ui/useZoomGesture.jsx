import { useEffect, useRef } from 'react';

// Wheel notches, trackpad inertia and touch pinches share one semantic action.
// A gesture ends after the wheel is quiet or the fingers leave the surface.
export function useZoomGesture(pane, changeZoom) {
  const action = useRef(changeZoom);
  useEffect(() => {
    action.current = changeZoom;
  }, [changeZoom]);
  useEffect(() => {
    const element = pane.current;
    let lastWheel = -Infinity,
      lastDirection = 0,
      busy = false,
      pinch = null;
    const move = (direction, point) => {
      if (busy) return;
      busy = true;
      Promise.resolve(action.current(direction, point)).finally(() => {
        busy = false;
      });
    };
    const wheel = (event) => {
      if (!event.target.closest('.react-flow') || !event.deltaY) return;
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      const fresh =
        event.timeStamp - lastWheel > 180 || direction !== lastDirection;
      lastWheel = event.timeStamp;
      lastDirection = direction;
      if (fresh) move(direction, { x: event.clientX, y: event.clientY });
    };
    const distance = (touches) =>
      Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY,
      );
    const touch = (event) => {
      if (!event.target.closest('.react-flow')) return;
      if (event.touches.length !== 2) {
        pinch = null;
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const span = distance(event.touches);
      if (!pinch) pinch = { span, moved: false };
      const ratio = span / pinch.span;
      if (!pinch.moved && (ratio > 1.12 || ratio < 0.88)) {
        pinch.moved = true;
        move(ratio > 1 ? 1 : -1, {
          x: (event.touches[0].clientX + event.touches[1].clientX) / 2,
          y: (event.touches[0].clientY + event.touches[1].clientY) / 2,
        });
      }
    };
    element.addEventListener('wheel', wheel, { passive: false });
    const touchEvents = ['touchstart', 'touchmove', 'touchend', 'touchcancel'];
    for (const name of touchEvents)
      element.addEventListener(name, touch, { passive: false, capture: true });
    return () => {
      element.removeEventListener('wheel', wheel);
      for (const name of touchEvents)
        element.removeEventListener(name, touch, true);
    };
  }, [pane]);
}
