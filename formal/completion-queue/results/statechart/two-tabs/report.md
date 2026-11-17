# CompletionQueue

TLC reached 1,351 states, more than the chart budget of 500, so the chart draws only the bug paths: 10 states and 7 arrows.
The chart does not draw 5 steps that stay in one chart state.
The step the request fails or times out changes Tab A and Browser storage at the same time.

## ClearedStaysCleared breaks

The shortest path has 11 steps: 0. Tab A Idle, Tab B Idle, Browser storage Nothing queued, Server Not recorded

1. a guide is completed: Tab A Idle, Tab B Idle, Browser storage Record queued, Server Not recorded
2. the drain timer fires: Tab A Taking the lease, Tab B Idle, Browser storage Record queued, Server Not recorded
3. the tab reads the lease: Tab A Taking the lease, Tab B Idle, Browser storage Record queued, Server Not recorded
4. the tab writes its lease: Tab A Taking the lease, Tab B Idle, Browser storage Record queued, Server Not recorded
5. the tab reads the lease back: Tab A Draining, Tab B Idle, Browser storage Record queued, Server Not recorded
6. the tab takes the next record: Tab A Draining, Tab B Idle, Browser storage Record queued, Server Not recorded
7. the tab reads the lease: Tab A Draining, Tab B Idle, Browser storage Record queued, Server Not recorded
8. the tab renews its lease: Tab A Draining, Tab B Idle, Browser storage Record queued, Server Not recorded
9. the tab sends the record: Tab A Waiting for the server, Tab B Idle, Browser storage Record queued, Server Not recorded
10. the reader resets all progress in Tab B: Tab A Waiting for the server, Tab B Idle, Browser storage Withdrawn, Server Not recorded
11. the request fails or times out: Tab A Draining, Tab B Idle, Browser storage Withdrawn record is back, Server Not recorded

## Rules that hold

TypeOK, OneRecordPerEvent, NoSilentLoss, NoDeadlock
