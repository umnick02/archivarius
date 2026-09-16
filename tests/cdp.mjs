import fs from 'node:fs/promises';

export async function connectBrowser(endpoint) {
  const targets = await (await fetch(endpoint + '/json/list')).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('CDP_NO_PAGE: ' + endpoint);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
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

// Click the centre of a control the way a user does, through real input events.
// A control that is absent or collapsed to nothing fails the suite instead of
// swallowing the click, so a broken selector cannot pass as a working one.
export const clicker =
  (browser, { settle = 400 } = {}) =>
  async (selector, count = 1) => {
    const point = await browser.evaluate((selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error('CONTROL_MISSING');
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) throw new Error('CONTROL_HIDDEN');
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }, selector);
    for (const type of ['mousePressed', 'mouseReleased'])
      await browser.call('Input.dispatchMouseEvent', {
        type,
        ...point,
        button: 'left',
        clickCount: count,
      });
    await pause(settle);
  };

// Wait for the state the page is supposed to reach instead of guessing how long
// a render takes. A condition that never holds fails with what it last saw, so a
// slow machine cannot flake the suite and a broken transition cannot pass by
// outlasting a sleep.
export const waiter =
  (browser, { timeout = 5000, interval = 25 } = {}) =>
  async (fn, ...args) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      const value = await browser.evaluate(fn, ...args);
      if (value) return value;
      if (Date.now() > deadline)
        throw new Error(
          'WAIT_TIMEOUT: ' + JSON.stringify(value) + ' from ' + fn.toString(),
        );
      await pause(interval);
    }
  };

// Wait for an animated value — a camera, a relayout — to stop moving. There is
// no single state to assert here, so the end of the movement is the signal.
export const settler =
  (browser, { timeout = 5000, interval = 50, quiet = 2 } = {}) =>
  async (fn, ...args) => {
    const deadline = Date.now() + timeout;
    let previous,
      still = 0;
    for (;;) {
      const value = JSON.stringify(await browser.evaluate(fn, ...args));
      still = value === previous ? still + 1 : 0;
      previous = value;
      if (still >= quiet) return JSON.parse(value);
      if (Date.now() > deadline)
        throw new Error('SETTLE_TIMEOUT: ' + value + ' from ' + fn.toString());
      await pause(interval);
    }
  };
