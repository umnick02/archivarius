import React, { forwardRef, useEffect, useId, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { App } from './App.jsx';
import { ArchitectureContext, format } from './context.jsx';
import { prepareArchitecture, readResources } from './load.mjs';
import { colors } from './view.mjs';

class MapBoundary extends React.Component {
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
  {
    source,
    locale = 'ru',
    assetsBaseUrl,
    className = '',
    style,
    onReady,
    onError,
  },
  ref,
) {
  const [state, setState] = useState({ source, locale, assetsBaseUrl });
  const callbacks = useRef({ onReady, onError });
  callbacks.current = { onReady, onError };
  const instanceId = 'archivarius-' + useId().replace(/[^a-zA-Z0-9-]/g, '');
  useEffect(() => {
    const controller = new AbortController();
    const identity = { source, locale, assetsBaseUrl };
    setState(identity);
    let resources;
    readResources({ locale, assetsBaseUrl, signal: controller.signal })
      .then(async (value) => {
        resources = value;
        const prepared = await prepareArchitecture(source, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setState({ ...identity, value: { ...resources, ...prepared } });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        controller.abort();
        setState({ ...identity, error, copy: resources?.copy });
        callbacks.current.onError?.(error);
      });
    return () => controller.abort();
  }, [source, locale, assetsBaseUrl]);
  const current =
    state.source === source &&
    state.locale === locale &&
    state.assetsBaseUrl === assetsBaseUrl;
  const value = current && state.value;
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
      {error ? (
        <div className="model-error" role="alert">
          {errorText}
        </div>
      ) : value ? (
        <MapBoundary onError={(error) => callbacks.current.onError?.(error)}>
          <ArchitectureContext.Provider
            value={{ ...value, rootColors, instanceId }}
          >
            <ReactFlowProvider>
              <App
                ref={ref}
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
