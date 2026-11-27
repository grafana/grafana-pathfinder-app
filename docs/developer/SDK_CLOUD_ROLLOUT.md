# Promoting the Pathfinder App SDK backend

Jay Clifford owns Cloud rollout sign-off for dev, ops and prod. Record the following evidence in the deployment PR for each environment before dispatching an SDK-only release.

1. Publish the adaptive build (#2404) and soak it in this environment. Record the deployed frontend version, backend image digest, registration revision, observation window and traffic on each route. Keep all three revisions available for rollback.
2. Check a real authenticated read and write through the registered routes. Verify namespace, stable caller subject and delegated identity on the upstream API, including the innermost actor role for an admin operation. Test an ordinary Viewer and an admin. A healthy discovery endpoint alone cannot verify delegation. Use caller token exchange for writes.
3. Confirm the signing-key source and rotation procedure with the host team. Verify issuer, audience, namespace, expiry, bounded same-origin key fetches and removal of a revoked key across every replica. Remote signing keys are refreshed at least once per five minutes of use. Fetches have a five-second timeout and reject off-origin redirects. Inline keys remain tied to the process environment and require restarting every replica during rotation. Verify these controls on the deployed artifact.
4. Agree with the backend team which manifest owns each shared kind, role and route. Compare effective Viewer grants on the live tenant, including named achievement reads and completion or assignment writes. Verify cross-user access restrictions. Confirm the public achievements definitions URL serves the intended catalogue and exercise an award write against it. Record a tested way to stop achievement writes before enabling them broadly.
5. Exercise frontend pin, backend image and registration rollback separately. Verify existing records remain readable after each rollback, and capture route mix and failed writes. Promote to the next environment only after Jay records sign-off.

## Check assignment reads after each dev wave

Use a signed-in learner's GCX context and the namespace of the stack being tested. For example, this checks Pathfinder dev without printing learner data:

```sh
set -o pipefail
gcx api --context pathfinder-dev \
  '/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/stacks-9239/backend/assignments/my' -o json |
  jq -e '.capability.available == true and (.assignments | type == "array")'
```

An empty assignments array is valid. Record the stack, rollout version, and result. If the request returns 503, follow its trace through Grafana Router and check the service token's delegated permission for `pathfinderbackend.ext.grafana.app/assignments:get`. The November dev rollout served health successfully while this permission was missing. On the [dev rollout dashboard](https://ops.grafana-ops.net/d/pathfinder-sdk-dev-rollout), use the gateway HTTP status for the request outcome. A provider log saying that a handler succeeded can also accompany an HTTP error.

## Publish workflow inputs

| Input               | Use                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `branch`            | Source branch, default `main`. Select the trial branch for a dev branch publish.                                     |
| `environment`       | Target `dev`, `ops` or `prod`.                                                                                       |
| `deploy-sdk-to-dev` | Include the SDK rollout when publishing a trial branch to dev. Defaults to false.                                    |
| `sdk-only-version`  | Reuse an existing dev catalogue version for an SDK-only dev rollout. Verify its frontend matches the intended trial. |
| `docs-only`         | Publish documentation only. Leave the SDK-only version empty.                                                        |

The plugin needs Grafana 13.3.0 or later because of the App Platform migration. `grafanaDependency` in `src/plugin.json` is still `>=13.1.0-0`. Bundled guides and the public recommendations feed remain available without registration. Features that persist data through SDK resources require a capable host and healthy registered routes.
