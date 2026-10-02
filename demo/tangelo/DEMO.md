# Tangelo completion webhook: local demo

An exploratory prototype, not for production. When a learner completes a guide, the plugin backend posts the completion to Tangelo's task-completion endpoint. This demo runs that flow on a local Grafana against a fake Tangelo endpoint. It never calls the real Tangelo service.

## How the prototype works

1. When a completion is queued, the frontend records `window.location.href` as `pathfinderUrl` on the existing `POST /completion-records` request.
2. The backend writes the durable completion record. Only after that write succeeds (or comes back as an idempotent `409` replay) does the backend send the webhook. It sends only when the switch is on and both credentials are provisioned.
3. The webhook body is `{employee_email, path_finder_url, completed_at}`. The email comes from the verified Grafana ID token, never from the request body. The headers are `Authorization: Bearer <token>` and `X-User-Id: <service-account user id>`.
4. The send runs in the background with a 5-second timeout. It cannot block the completion response, fail it, or change it. The log records only the HTTP status and Tangelo's short `status` token.

Configuration:

| Setting                                                | Where it lives   | Who sets it                 |
| ------------------------------------------------------ | ---------------- | --------------------------- |
| `tangeloCompletionToken`                               | `secureJsonData` | Per-stack provisioning only |
| `tangeloCompletionServiceAccountUserID`                | `secureJsonData` | Per-stack provisioning only |
| `tangeloCompletionEnabled` (default `false`)           | `jsonData`       | Admin, from the config page |
| `tangeloCompletionEndpoint` (`tangelodemo` build only) | `jsonData`       | Demo provisioning file      |

The config page has a **Tangelo integration** section at the bottom. It contains the switch and an indicator. The indicator reads `GET /api/plugins/grafana-pathfinder-app/resources/tangelo-integration/status`, which is admin-only and returns `{credentialsPresent, enabled}`. That response holds booleans only.

### Why the demo needs a special backend build

Release builds always post to the fixed `https://backend.tangelo.ai/api/v1/task_completions`. No setting can change that address, so a release binary cannot send the bearer token anywhere else.

The demo backend is built with the `tangelodemo` Go build tag (`pkg/plugin/tangelo_demo.go`). That tag makes two changes:

- It honors `jsonData.tangeloCompletionEndpoint`. The Grafana container reaches the fake receiver at `host.docker.internal`, so a "loopback only" override would not work here.
- It replaces the App Platform completion store with an in-memory one. A local Docker Grafana does not serve App Platform completion records, so without this the durable write never succeeds and the webhook never fires.

Never ship a `tangelodemo` binary.

## Steps

Run every command from the repository root. You need Docker, Node.js 24+, and Go.

1. Start the fake Tangelo receiver in its own terminal:

   ```bash
   node demo/tangelo/fake-tangelo.mjs
   ```

   It listens on `http://localhost:8787/api/v1/task_completions`. It accepts only the synthetic credential pair in `demo/tangelo/app-provisioning.yaml`; any other pair gets a `401`. It answers `201 {"status":"completed"}` the first time a learner completes a given URL and `200 {"status":"already_completed"}` after that.

2. Build the frontend, then the demo backend:

   ```bash
   npm run build
   bash demo/tangelo/build-demo-backend.sh
   ```

3. Start the demo Grafana. It runs on port 3030 under its own Compose project, separate from the regular dev stack:

   ```bash
   docker compose -p pathfinder-tangelo -f docker-compose.yaml \
     -f demo/tangelo/docker-compose.tangelo.yaml up -d --build grafana
   ```

   The overlay mounts `demo/tangelo/app-provisioning.yaml`, which turns the switch on, points the endpoint at the fake receiver, and sets the two synthetic secure values. It also enables the `idForwarding` feature toggle and the completion-records aggregation toggle.

4. Create a learner who has a work email. Basic auth is off in the dev image, so log in to get a session first:

   ```bash
   curl -s -c /tmp/tangelo-admin.jar -H 'Content-Type: application/json' \
     -X POST http://localhost:3030/login -d '{"user":"admin","password":"admin"}'
   curl -s -b /tmp/tangelo-admin.jar -H 'Content-Type: application/json' \
     -X POST http://localhost:3030/api/admin/users \
     -d '{"name":"Demo Learner","email":"learner@example.com","login":"learner","password":"learner-demo-pw"}'
   ```

5. Optional: check the config page. Log in as `admin` / `admin` and open `http://localhost:3030/plugins/grafana-pathfinder-app`. At the bottom, **Tangelo integration** shows the switch turned on and the indicator **Tangelo credentials are provisioned for this stack**. If you turn the switch off, the indicator's route reports `enabled: false` and completions stop reaching the receiver. Turn it back on before you continue.

6. Log out. Then log in as `learner` / `learner-demo-pw` and open:

   ```text
   http://localhost:3030/?doc=bundled:welcome-to-grafana
   ```

   Complete the guide. The learner is a Viewer, so skip the steps that need roles the learner does not have (Explore, data sources, Administration, Plugins). Use **Do it** on the rest.

7. The receiver terminal shows the call:

   ```text
   -> POST /api/v1/task_completions
      headers: { "authorization": "Bearer demo-tangelo-token", "x-user-id": "demo-service-account-user", ... }
      body: {"employee_email":"learner@example.com","path_finder_url":"http://localhost:3030/alerting","completed_at":"..."}
   <- 201 {"status":"completed",...}
   ```

   The plugin log records the outcome, without headers or secrets:

   ```bash
   docker logs grafana-pathfinder-tangelo 2>&1 | grep 'tangelo completion'
   # msg="tangelo completion sent" status=201 result=completed
   ```

   A second send for the same learner and URL gets `already_completed`. To see it, replay the same write: post the same body with the same `idempotencyKey` to `/api/plugins/grafana-pathfinder-app/resources/completion-records` while logged in as the learner. The backend treats the replay as a `409` and resends.

8. Clean up:

   ```bash
   docker compose -p pathfinder-tangelo -f docker-compose.yaml \
     -f demo/tangelo/docker-compose.tangelo.yaml down -v
   ```

   Then rebuild a release backend with `npm run build:all` or `mage` before you use `dist/` anywhere else.
