import {
  Component,
  forwardRef,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { App } from './App.jsx';
import { ArchitectureContext, format, plural } from './context.jsx';
import { prepareArchitecture, readResources } from './load.mjs';
import { colors } from './view.mjs';
import { projectMapSummary } from '../model/project-view.mjs';

class MapBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    this.props.onError?.(error);
  }
  render() {
    return this.state.error ? (
      <div className="model-error" role="alert">
        {this.state.error.message}
      </div>
    ) : (
      this.props.children
    );
  }
}

export const ArchitectureMap = forwardRef(function ArchitectureMap(
  { source, assetsBaseUrl, className = '', style, onReady, onError },
  ref,
) {
  const [state, setState] = useState({ source, assetsBaseUrl });
  // WCAG 4.1.3: one polite region for the whole surface. It is mounted empty and
  // only ever updated, because a region that arrives with its text already in it
  // is not a change any assistive technology has to report.
  const [announcement, setAnnouncement] = useState('');
  const callbacks = useRef({ onReady, onError });
  callbacks.current = { onReady, onError };
  const openFile = useRef(null),
    revision = useRef(0),
    surface = useRef(null);
  const [dragging, setDragging] = useState(false);
  const instanceId = 'archivarius-' + useId().replace(/[^a-zA-Z0-9-]/g, '');
  useEffect(() => {
    const identity = { source, assetsBaseUrl };
    let active, shown;
    // Host sources and transferred files use one cancellable preparation path.
    // A file replaces the drawing only after validation and layout both succeed.
    const load = async (input, local = false) => {
      active?.abort();
      const controller = new AbortController();
      active = controller;
      const nextRevision = ++revision.current;
      setState({ ...(local && shown ? shown : identity), pending: true });
      let resources;
      try {
        resources = await readResources({
          assetsBaseUrl,
          signal: controller.signal,
        });
        const prepared = await prepareArchitecture(input, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        shown = {
          ...identity,
          value: { ...resources, ...prepared },
          revision: nextRevision,
          local,
        };
        setState({ ...shown, pending: true });
        setAnnouncement(
          plural(
            resources.copy,
            resources.copy.announcements.loaded,
            prepared.graph.nodes.size,
            { title: prepared.model.title || resources.copy.title },
          ),
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        controller.abort();
        if (local && shown) setState({ ...shown, fileError: error });
        else setState({ ...identity, error, copy: resources?.copy });
        if (resources?.copy)
          setAnnouncement(
            format(resources.copy.announcements.failure, {
              code: resources.copy.errors[error.code] || error.message,
            }),
          );
        // A rejected file leaves the existing controller usable. Fatal host
        // loading failures retain the public onError/ready contract.
        if (!local || !shown) callbacks.current.onError?.(error);
      }
    };
    openFile.current = {
      load: (file) => load(file, true),
      reject: (error) => {
        active?.abort();
        setState((held) => ({ ...held, pending: false, fileError: error }));
      },
    };
    load(source);
    return () => {
      active?.abort();
      openFile.current = null;
    };
  }, [source, assetsBaseUrl]);
  const current =
    state.source === source && state.assetsBaseUrl === assetsBaseUrl;
  const value = current && state.value;
  const copy = value?.copy || state.copy;
  const accepts = (event) =>
    !event.target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
    );
  const hasFiles = (data) => [...(data?.types || [])].includes('Files');
  const receiveFiles = (event, data) => {
    if (!accepts(event)) return;
    const files = [...(data?.files || [])];
    if (!files.length && !hasFiles(data)) return;
    event.preventDefault();
    event.stopPropagation();
    if (files.length !== 1 || !/\.json$/i.test(files[0].name)) {
      if (copy)
        openFile.current?.reject(
          files.length ? copy.fileOpen.oneJSON : copy.fileOpen.unreadable,
        );
      return;
    }
    openFile.current?.load(files[0]);
  };
  const mapSummaries = useMemo(
    () =>
      value?.project
        ? Object.fromEntries(
            value.project.records
              .filter((record) => ['component', 'scope'].includes(record.type))
              .map((record) => [
                record.key,
                projectMapSummary(value.project, value.analysis, record.key),
              ]),
          )
        : null,
    [value],
  );
  const error = current && (state.error || state.fileError);
  const rootColors =
    value &&
    Object.fromEntries(
      value.model.nodes.map((node, i) => [node.key, colors[i % colors.length]]),
    );
  const errorText =
    error &&
    (typeof error === 'string'
      ? error
      : copy
        ? format(copy.modelError, {
            error: [error.code || error.message, ...(error.issues || [])]
              .map((issue) => {
                const [code, key] = issue.split(':');
                return format(copy.errors[code] || code, { key });
              })
              .join('\n'),
          })
        : error.message);
  return (
    <div
      ref={surface}
      className={'archivarius ' + className}
      style={style}
      data-instance={instanceId}
      data-file-drag={dragging || undefined}
      tabIndex={value ? undefined : -1}
      aria-busy={!!state.pending || (!value && !error)}
      onPaste={(event) => {
        if (!value || event.target.closest('.map-pane'))
          receiveFiles(event, event.clipboardData);
      }}
      onDragEnter={(event) => {
        if (accepts(event) && hasFiles(event.dataTransfer)) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragOver={(event) => {
        if (accepts(event) && hasFiles(event.dataTransfer)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setDragging(false);
      }}
      onDrop={(event) => {
        setDragging(false);
        receiveFiles(event, event.dataTransfer);
      }}
      onKeyDownCapture={(event) => {
        if (event.key === 'Escape' && state.fileError) {
          event.preventDefault();
          event.stopPropagation();
          setState((held) => ({ ...held, fileError: null }));
        }
      }}
    >
      <p
        className="map-announcement"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </p>
      {state.fileError && value && (
        <div
          className="file-open-error"
          data-control="file-open-error"
          role="alert"
        >
          <span>{errorText}</span>
          <button
            className="quiet"
            data-control="dismiss-file-error"
            onClick={() => {
              setState((held) => ({ ...held, fileError: null }));
              surface.current
                ?.querySelector('.map-pane')
                ?.focus({ preventScroll: true });
            }}
          >
            {copy.fileOpen.dismiss}
          </button>
        </div>
      )}
      {error && !value ? (
        <div className="model-error" role="alert">
          {errorText}
        </div>
      ) : value ? (
        <MapBoundary
          key={state.revision}
          onError={(error) => callbacks.current.onError?.(error)}
        >
          <ArchitectureContext.Provider
            value={{ ...value, rootColors, instanceId, mapSummaries }}
          >
            <ReactFlowProvider>
              <App
                ref={ref}
                announce={setAnnouncement}
                onReady={(api) => {
                  callbacks.current.onReady?.(api);
                  setState((held) => ({ ...held, pending: false }));
                  const document = surface.current?.ownerDocument;
                  if (
                    state.local &&
                    document &&
                    (document.activeElement === document.body ||
                      surface.current.contains(document.activeElement))
                  )
                    surface.current
                      .querySelector('.map-pane')
                      ?.focus({ preventScroll: true });
                }}
              />
            </ReactFlowProvider>
          </ArchitectureContext.Provider>
        </MapBoundary>
      ) : (
        <progress className="map-loading" />
      )}
    </div>
  );
});
