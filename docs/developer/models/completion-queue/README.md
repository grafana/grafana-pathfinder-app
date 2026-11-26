# Completion queue model-checking pilot

Can two tabs retry a completion after lease expiry and reset while preserving its original key and keeping withdrawn records out of shared storage? Can a second engineer replay the ordering and update the model?

The local contract protects a response handled by the queue instance that was cleared. A stronger, owner-wide interpretation also covers a response handled by another tab. Check those scopes separately: each queue has its own in-memory membership guard.
