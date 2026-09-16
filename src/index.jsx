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
    rejectPending,
    api;
  const { source: initialSource, onReady, onError, ...props } = options || {};
  const handle = {
    ready: null,
    load(source) {
      if (destroyed)
        return Promise.reject(new ArchitectureError('MAP_DESTROYED'));
      rejectPending?.(new DOMException('LOAD_SUPERSEDED', 'AbortError'));
      api = null;
      const request = ++sequence;
      const promise = new Promise((resolve, reject) => {
        rejectPending = reject;
        root.render(
          <ArchitectureMap
            key={request}
            {...props}
            source={source}
            onReady={(next) => {
              if (request !== sequence || destroyed) return;
              api = next;
              rejectPending = null;
              resolve();
              onReady?.(next);
            }}
            onError={(error) => {
              if (request !== sequence || destroyed) return;
              api = null;
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
      if (!api) throw new ArchitectureError('MAP_NOT_READY');
      return api.home();
    },
    focus(key) {
      if (!api) throw new ArchitectureError('MAP_NOT_READY');
      return api.focus(key);
    },
    inspect(key) {
      if (!api) throw new ArchitectureError('MAP_NOT_READY');
      api.inspect(key);
    },
    snapshot() {
      if (!api) throw new ArchitectureError('MAP_NOT_READY');
      return api.snapshot();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      api = null;
      rejectPending?.(new DOMException('MAP_DESTROYED', 'AbortError'));
      rejectPending = null;
      root.unmount();
      mounts.delete(container);
    },
  };
  handle.ready = handle.load(initialSource);
  return handle;
}
