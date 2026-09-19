import { createRoot } from 'react-dom/client';
import { ArchitectureMap } from './ui/ArchitectureMap.jsx';
import { ArchitectureError } from './core.mjs';

export { ArchitectureMap } from './ui/ArchitectureMap.jsx';
// The browser entry adds the map to the parse surface a host needs to feed and
// catch it. Project authoring, analysis and digests stay on `archivarius/core`;
// republishing a few of them here would only make the split arbitrary.
export {
  ArchitectureError,
  parseArchitecture,
  validateArchitecture,
} from './core.mjs';

const mounts = new WeakSet();

export function mountArchitectureMap(container, options) {
  if (!container || container.nodeType !== 1)
    throw new ArchitectureError('CONTAINER_REQUIRED');
  if (mounts.has(container)) throw new ArchitectureError('CONTAINER_IN_USE');
  if (container.childNodes.length)
    throw new ArchitectureError('CONTAINER_NOT_EMPTY');
  mounts.add(container);
  const root = createRoot(container);
  let destroyed = false,
    sequence = 0,
    rejectPending;
  const api = { current: null };
  const { source: initialSource, onReady, onError, ...props } = options || {};
  const handle = {
    ready: null,
    load(source) {
      if (destroyed)
        return Promise.reject(new ArchitectureError('MAP_DESTROYED'));
      rejectPending?.(new DOMException('LOAD_SUPERSEDED', 'AbortError'));
      api.current = null;
      const request = ++sequence;
      const promise = new Promise((resolve, reject) => {
        rejectPending = reject;
        root.render(
          <ArchitectureMap
            ref={api}
            key={request}
            {...props}
            source={source}
            onReady={(next) => {
              if (request !== sequence || destroyed) return;
              api.current = next;
              rejectPending = null;
              resolve();
              onReady?.(next);
            }}
            onError={(error) => {
              if (request !== sequence || destroyed) return;
              api.current = null;
              rejectPending = null;
              reject(error);
              onError?.(error);
            }}
          />,
        );
      });
      return promise;
    },
    home() {
      if (!api.current) throw new ArchitectureError('MAP_NOT_READY');
      return api.current.home();
    },
    focus(key) {
      if (!api.current) throw new ArchitectureError('MAP_NOT_READY');
      return api.current.focus(key);
    },
    inspect(key) {
      if (!api.current) throw new ArchitectureError('MAP_NOT_READY');
      api.current.inspect(key);
    },
    snapshot() {
      if (!api.current) throw new ArchitectureError('MAP_NOT_READY');
      return api.current.snapshot();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      api.current = null;
      rejectPending?.(new DOMException('MAP_DESTROYED', 'AbortError'));
      rejectPending = null;
      root.unmount();
      mounts.delete(container);
    },
  };
  handle.ready = handle.load(initialSource);
  return handle;
}
