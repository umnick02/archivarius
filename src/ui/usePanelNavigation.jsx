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
      panel: current.current && {
        ...current.current,
        scroll: element?.scrollTop || 0,
        disclosures: [
          ...(element?.querySelectorAll('details[open][data-disclosure]') ||
            []),
        ].map((e) => e.dataset.disclosure),
      },
      scene: callbacks.current.readScene(),
      focus: document.activeElement,
    };
  }, [root]);
  // Map destinations and inspector destinations share the same history. A
  // drawing without an open panel is a destination too.
  const checkpoint = useCallback(() => {
    stack.current.push(capture());
    setDepth(stack.current.length);
  }, [capture]);
  const open = useCallback(
    (next, remember = true) => {
      const workspace =
        next.type === 'record'
          ? next.workspace ||
            current.current?.view ||
            current.current?.workspace ||
            'map'
          : undefined;
      if (remember) checkpoint();
      if (!current.current) returnFocus.current = document.activeElement;
      commit({ ...next, workspace, scroll: 0, entryId: ++sequence.current });
    },
    [checkpoint, commit],
  );
  const replace = useCallback(
    (patch) => commit({ ...current.current, ...patch }),
    [commit],
  );
  const back = useCallback(async () => {
    const previous = stack.current.pop();
    if (!previous) return;
    commit(previous.panel && { ...previous.panel, scene: previous.scene });
    await callbacks.current.restoreScene(previous.scene);
    (previous.focus?.isConnected
      ? previous.focus
      : root.current?.querySelector(
          previous.panel && !previous.scene.mobileMap
            ? '[data-control="inspector"]'
            : '.map-pane',
        )
    )?.focus({ preventScroll: true });
  }, [commit, root]);
  const close = useCallback(() => {
    commit(null);
    const target = returnFocus.current;
    queueMicrotask(() =>
      (target?.isConnected ? target : root.current)?.focus({
        preventScroll: true,
      }),
    );
  }, [commit, root]);
  const reset = useCallback(
    (next = current.current) => {
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
    checkpoint,
    canBack: depth > 0,
  };
}
