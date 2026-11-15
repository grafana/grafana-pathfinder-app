/**
 * Network fixtures for the pilot, served outside the browser.
 *
 * Playwright's `page.route` cannot be used here: Bombadil attaches over CDP and
 * instruments scripts through the same Fetch interception, and the two stall
 * each other (`timed out waiting for response for CSS.enable`). So the fixtures
 * live in two local servers instead:
 *
 *   - a reverse proxy in front of Grafana that answers only the completion
 *     write route (404, the "route not served here" regime, so queued facts stay
 *     readable) and the package catalogue, and forwards everything else;
 *   - an HTTPS server standing in for interactive-learning.grafana.net, which
 *     Chromium is pointed at with --host-resolver-rules.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { join } from 'node:path';

import pluginJson from '../../src/plugin.json';
import { fixtureCatalogue, fixtureContent, fixtureManifest, type PackageFixture } from '../helpers/completion.fixtures';

const RESOURCES = `/api/plugins/${pluginJson.id}/resources`;

export interface FixtureServers {
  proxyUrl: string;
  cdnPort: number;
  /** Completion write POSTs seen by the stubbed route. */
  writeRequests: () => number;
  close: () => Promise<void>;
}

function listen(server: http.Server | https.Server, port: number): Promise<number> {
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : port);
    });
  });
}

export async function startFixtureServers(options: {
  grafanaUrl: string;
  proxyPort: number;
  cdnPort: number;
  workDir: string;
  fixtures: PackageFixture[];
}): Promise<FixtureServers> {
  const { grafanaUrl, fixtures } = options;
  const upstream = new URL(grafanaUrl);
  let writes = 0;

  const proxy = http.createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (path === `${RESOURCES}/completion-records`) {
      if (req.method === 'POST') {
        writes++;
      }
      res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not-found"}');
      return;
    }
    if (path === `${RESOURCES}/package-recommendations`) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(fixtureCatalogue(fixtures)));
      return;
    }
    const forward = http.request(
      { host: upstream.hostname, port: upstream.port, path: req.url, method: req.method, headers: req.headers },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      }
    );
    forward.on('error', () => res.writeHead(502).end());
    req.pipe(forward);
  });

  const key = join(options.workDir, 'cdn-key.pem');
  const cert = join(options.workDir, 'cdn-cert.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-keyout',
      key,
      '-out',
      cert,
      '-subj',
      '/CN=interactive-learning.grafana.net',
      '-addext',
      'subjectAltName=DNS:interactive-learning.grafana.net',
    ],
    { stdio: 'ignore' }
  );

  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const cdn = https.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
    if (req.method === 'OPTIONS') {
      res
        .writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, OPTIONS',
          'access-control-allow-headers': '*',
        })
        .end();
      return;
    }
    const segments = (req.url ?? '').split('?')[0].split('/').filter(Boolean);
    const file = segments.at(-1);
    const fixture = byId.get(segments.at(-2) ?? '');
    const body =
      fixture && file === 'manifest.json'
        ? fixtureManifest(fixture)
        : fixture && file === 'content.json'
          ? fixtureContent(fixture)
          : undefined;
    if (!body) {
      res.writeHead(404, { 'access-control-allow-origin': '*' }).end('not a fixture');
      return;
    }
    res
      .writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
      .end(JSON.stringify(body));
  });

  const proxyPort = await listen(proxy, options.proxyPort);
  const cdnPort = await listen(cdn, options.cdnPort);

  return {
    proxyUrl: `http://localhost:${proxyPort}`,
    cdnPort,
    writeRequests: () => writes,
    close: () =>
      new Promise((resolve) => {
        proxy.close(() => cdn.close(() => resolve()));
        proxy.closeAllConnections();
        cdn.closeAllConnections();
      }),
  };
}
