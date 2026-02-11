# Guide dependencies design

> **Superseded.** This document originally specified the Debian-inspired dependency model for Pathfinder guides — dependency types, virtual capabilities, test environment requirements, and the relationship to block-level requirements. All of this content has been incorporated into the [Pathfinder package design](./PATHFINDER-PACKAGE-DESIGN.md), which is now the authoritative source for guide-level metadata, dependencies, and targeting.

See the following sections in the package design doc:

- [Dependencies](./PATHFINDER-PACKAGE-DESIGN.md#dependencies) — dependency types, semantics, virtual capabilities
- [Metadata](./PATHFINDER-PACKAGE-DESIGN.md#metadata) — guide-level metadata fields
- [Targeting](./PATHFINDER-PACKAGE-DESIGN.md#targeting) — advisory recommendation targeting
- [Future-proofing → Test environment metadata](./PATHFINDER-PACKAGE-DESIGN.md#future-proofing) — Layer 4 E2E routing metadata

## Historical note

This document seeded the dependency vocabulary (`depends`, `recommends`, `suggests`, `provides`, `conflicts`, `replaces`) and the Debian package analogy that the package design adopted. It was written before the two-file package model (`content.json` + `package.json`) was designed.
