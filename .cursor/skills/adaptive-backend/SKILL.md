---
name: adaptive-backend
description: Use when changing Pathfinder backend routes, frontend transport or persisted features while the App SDK provider and legacy plugin handlers coexist.
---

# Change the adaptive backend

## Follow a request on main

A **binary** is the executable Grafana starts. A **provider** is Go code that supplies routes to the App SDK. On self-hosted Grafana, `pkg/main.go` runs the provider alongside the legacy plugin handlers registered by `sdkplugin.WithAppFunc(plugin.NewApp)`. In Cloud, the namespaced SDK route can reach the separately deployed backend serving multiple stacks. The browser bundle, deployed backend and route registration can change independently.

Follow a settings read as a worked example:

1. `src/lib/backend-routes.ts` builds the URL. On a Cloud stack, or a namespaced host with both registration flags, startup probes SDK health. A successful probe for the current namespace selects the SDK path. Before that, the adaptive build uses the plugin resource path.
2. Trace the selected handler in `pkg/provider/settings.go` or `pkg/plugin/`. Both use the settings service in `pkg/services/`. For SDK resource access, follow the caller-delegating client into `pkg/resourceaccess/`.
3. Keep the same settings resource and response shape across both paths. An SDK health response establishes route availability. Each operation still authenticates the caller and enforces its own permissions.

## Change a feature during coexistence

- Start with the existing route and both callers. Put shared decisions in `pkg/services/` and keep transport-specific work in the adapters. Cover existing resource names, missing records, status codes and retry behavior. Send each write once through the selected path. Replaying a failed SDK write on the legacy path can duplicate a committed operation.
- For a new SDK route, update its definition under `kinds/`, run `npm run generate:kinds`, and inspect the generated changes. Wire the provider and the matching compatibility behavior, then use the bounded `backendRoute()` helper in the browser. Check older Grafana hosts and the user role before exposing a save action. Keep the public recommendations feed and bundled guides available on supported Grafana 13.1+.
- Carry the verified caller and namespace into resource reads and writes. Preserve per-user cache isolation. Follow the existing, narrowly scoped assignment-status exception if changing assignment repair. Read [the identity and proxy contract](../../../docs/design/BACKEND_PROXY_PATTERN.md) before editing Go handlers.

## Verify both paths

Run `go test ./pkg/...` and the focused frontend route, transport and feature tests. Exercise the changed journey once with SDK discovery healthy and once with the legacy path selected. Check response shape and errors on both. For a write, reload and read the stored record, retry where supported, and check a restricted caller. For guide authoring, use the real Grafana setup and Playwright command in the [SDK runtime migration notes](../../../docs/design/BACKEND_PROXY_PATTERN.md#sdk-runtime-migration).

## Retire the compatibility path deliberately

Keep the legacy entry point and its contracts on the adaptive release line. To propose removal, follow the [Cloud rollout checks](../../../docs/developer/SDK_CLOUD_ROLLOUT.md). Record actual frontend, backend and registration versions, observed traffic on each route, caller-delegated reads and writes, and rollback results for the target wave. An idle legacy route on one stack gives no evidence about other stacks or older OSS hosts. When the SDK-only change lands, update this skill and its entry in AGENTS.md to match the supported runtime.
