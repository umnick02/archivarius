import { useCallback, useLayoutEffect, useRef, useState } from 'react';

export function usePanelNavigation(root, initial, readScene, restoreScene) {
  const [panel, setPanel] = useState(initial);
  const [depth, setDepth] = useState(0);
  const current = useRef(initial),
    stack = useRef([]),
    returnFocus = useRef(null);
  const sequence = useRef(0);
  const callbacks = useRef({ readScene, restoreScene });
  // The scene callbacks are only invoked from committed handlers, so they are
  // published after commit rather than mutated during render.
  useLayoutEffect(() => {
    callbacks.current = { readScene, restoreScene };
  }, [readScene, restoreScene]);
  const commit = useCallback((next) => {
    current.current = next;
    setPanel(next);
    setDepth(stack.current.length);
  }, []);
  const capture = useCallback(() => {
    const element = root.current?.querySelector('[data-control="inspector"]');
    return {
      ...current.current,
      scroll: element?.scrollTop || 0,
      disclosures: [
        ...(element?.querySelectorAll('details[open][data-disclosure]') || []),
      ].map((e) => e.dataset.disclosure),
      scene: callbacks.current.readScene(),
    };
  }, [root]);
  const open = useCallback(
    (next) => {
      const workspace =
        next.type === 'record'
          ? next.workspace ||
            current.current?.view ||
            current.current?.workspace ||
            'map'
          : undefined;
      if (current.current) stack.current.push(capture());
      else returnFocus.current = document.activeElement;
      commit({ ...next, workspace, scroll: 0, entryId: ++sequence.current });
    },
    [capture, commit],
  );
  const replace = useCallback(
    (patch) => commit({ ...current.current, ...patch }),
    [commit],
  );
  const back = useCallback(() => {
    const previous = stack.current.pop();
    if (!previous) return;
    callbacks.current.restoreScene(previous.scene);
    commit(previous);
  }, [commit]);
  const close = useCallback(() => {
    stack.current = [];
    commit(null);
    const target = returnFocus.current;
    queueMicrotask(() =>
      (target?.isConnected ? target : root.current)?.focus({
        preventScroll: true,
      }),
    );
  }, [commit, root]);
  const reset = useCallback(
    (next = null) => {
      stack.current = [];
      commit(next && { ...next, entryId: ++sequence.current });
    },
    [commit],
  );
  return {
    panel,
    open,
    replace,
    back,
    close,
    reset,
    canBack: depth > 0,
  };
}
