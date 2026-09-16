import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { connectBrowser, pause } from './cdp.mjs';

const root = new URL('../', import.meta.url);
const site = new URL('.runtime/consumer/dist/', root);
const base = '/embedded/maps/';
const mime = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.map': 'application/json',
  '.md': 'text/markdown',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
const candidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

const exists = (target) =>
  fs.access(target).then(
    () => true,
    () => false,
  );

const executable = async () => {
  for (const candidate of candidates)
    if (candidate && (await exists(candidate))) return candidate;
  throw new Error('CHROME_NOT_FOUND: install Chrome or set CHROME_PATH');
};

const serve = async () => {
  const server = http.createServer((request, response) => {
    const { pathname } = new URL(request.url, 'http://127.0.0.1');
    if (!pathname.startsWith(base)) {
      response.writeHead(404).end();
      return;
    }
    const relative = pathname.slice(base.length) || 'index.html';
    const file = new URL(
      relative.endsWith('/') ? relative + 'index.html' : relative,
      site,
    );
    if (!file.pathname.startsWith(site.pathname)) {
      response.writeHead(403).end();
      return;
    }
    fs.readFile(file).then(
      (body) => {
        response.writeHead(200, {
          'content-type':
            mime[path.extname(file.pathname)] || 'application/octet-stream',
          'content-length': body.length,
        });
        response.end(body);
      },
      () => response.writeHead(404).end(),
    );
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    origin: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

const launch = async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'archivarius-cdp-'));
  const chrome = spawn(
    await executable(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      '--user-data-dir=' + profile,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-extensions',
      '--disable-gpu',
      '--window-size=1440,1000',
      ...(process.platform === 'darwin'
        ? []
        : ['--no-sandbox', '--disable-dev-shm-usage']),
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const portFile = path.join(profile, 'DevToolsActivePort');
  let port;
  for (let attempt = 0; attempt < 100 && port === undefined; attempt++) {
    const text = await fs.readFile(portFile, 'utf8').catch(() => '');
    const [line] = text.split('\n');
    if (line && Number(line)) port = Number(line);
    else await pause(100);
  }
  if (port === undefined) {
    chrome.kill('SIGKILL');
    throw new Error('CHROME_NOT_READY: no DevToolsActivePort in ' + profile);
  }
  return {
    port,
    close: async () => {
      chrome.kill('SIGKILL');
      await fs.rm(profile, { recursive: true, force: true });
    },
  };
};

// Serves the packed-consumer build under its production base path and drives it
// in a private headless Chrome; both endpoints are ephemeral so parallel runs
// never collide.
export async function startHarness() {
  if (!(await exists(new URL('index.html', site))))
    throw new Error('CONSUMER_MISSING: run `npm run test:package` first');
  const server = await serve();
  let chrome;
  let browser;
  try {
    chrome = await launch();
    browser = await connectBrowser('http://127.0.0.1:' + chrome.port);
  } catch (error) {
    await chrome?.close();
    await server.close();
    throw error;
  }
  return {
    browser,
    url: server.origin + base,
    origin: server.origin,
    stop: async () => {
      browser.close();
      await chrome.close();
      await server.close();
    },
  };
}
