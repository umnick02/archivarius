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
  const instanceId = 'archivarius-' + useId().replace(/[^a-zA-Z0-9-]/g, '');
  useEffect(() => {
    const controller = new AbortController();
    const identity = { source, assetsBaseUrl };
    setState(identity);
    let resources;
    readResources({ assetsBaseUrl, signal: controller.signal })
      .then(async (value) => {
        resources = value;
        const prepared = await prepareArchitecture(source, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setState({ ...identity, value: { ...resources, ...prepared } });
        setAnnouncement(
          plural(
            resources.copy,
            resources.copy.announcements.loaded,
            prepared.graph.nodes.size,
            { title: prepared.model.title || resources.copy.title },
          ),
        );
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        controller.abort();
        setState({ ...identity, error, copy: resources?.copy });
        if (resources?.copy)
          setAnnouncement(
            format(resources.copy.announcements.failure, {
              code: resources.copy.errors[error.code] || error.message,
            }),
          );
        callbacks.current.onError?.(error);
      });
    return () => controller.abort();
  }, [source, assetsBaseUrl]);
  const current =
    state.source === source && state.assetsBaseUrl === assetsBaseUrl;
  const value = current && state.value;
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
  const error = current && state.error;
  const rootColors =
    value &&
    Object.fromEntries(
      value.model.nodes.map((node, i) => [node.key, colors[i % colors.length]]),
    );
  const errorText =
    error &&
    (state.copy
      ? format(state.copy.modelError, {
          error: [error.code || error.message, ...(error.issues || [])]
            .map((issue) => {
              const [code, key] = issue.split(':');
              return format(state.copy.errors[code] || code, { key });
            })
            .join('\n'),
        })
      : error.message);
  return (
    <div
      className={'archivarius ' + className}
      style={style}
      data-instance={instanceId}
      aria-busy={!value && !error}
    >
      <p
        className="map-announcement"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </p>
      {error ? (
        <div className="model-error" role="alert">
          {errorText}
        </div>
      ) : value ? (
        <MapBoundary onError={(error) => callbacks.current.onError?.(error)}>
          <ArchitectureContext.Provider
            value={{ ...value, rootColors, instanceId, mapSummaries }}
          >
            <ReactFlowProvider>
              <App
                ref={ref}
                announce={setAnnouncement}
                onReady={(api) => callbacks.current.onReady?.(api)}
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
