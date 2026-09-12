import fs from 'node:fs/promises';

export async function connectBrowser() {
  const targets = await (
    await fetch('http://127.0.0.1:44890/json/list')
  ).json();
  const socket = new WebSocket(
    targets.find((t) => t.type === 'page').webSocketDebuggerUrl,
  );
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let seq = 0;
  const pending = new Map(),
    listeners = new Map(),
    errors = [],
    requests = [],
    logs = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const task = pending.get(message.id);
      if (task) {
        pending.delete(message.id);
        message.error
          ? task.reject(message.error)
          : task.resolve(message.result);
      }
    } else if (message.method === 'Runtime.exceptionThrown')
      errors.push(message.params.exceptionDetails);
    else if (message.method === 'Network.requestWillBeSent')
      requests.push(message.params.request.url);
    else if (message.method === 'Runtime.consoleAPICalled')
      logs.push(message.params);
    for (const handler of listeners.get(message.method) || [])
      Promise.resolve(handler(message.params)).catch((error) =>
        errors.push(String(error)),
      );
  };
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (fn, ...args) => {
    const expression =
      '(' + fn.toString() + ')(...' + JSON.stringify(args) + ')';
    const result = await call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const capture = async (name) => {
    const result = await call('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(
      new URL('../.runtime/' + name + '.png', import.meta.url),
      Buffer.from(result.data, 'base64'),
    );
  };
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Network.enable');
  return {
    call,
    evaluate,
    capture,
    errors,
    requests,
    logs,
    on: (method, handler) => {
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method).add(handler);
      return () => listeners.get(method).delete(handler);
    },
    close: () => socket.close(),
  };
}

export const pause = (ms = 500) =>
  new Promise((resolve) => setTimeout(resolve, ms));
