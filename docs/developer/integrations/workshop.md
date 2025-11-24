# Workshop Integration

The Workshop integration (`src/integrations/workshop/`) provides features for workshop mode, including action capture and replay functionality.

## Overview

The Workshop integration enables recording and replaying user actions, which is useful for creating interactive guides and tutorials.

## Components

### Action Capture

**Location**: `src/integrations/workshop/action-capture.ts`

**Purpose**: Captures user actions for later replay

**Features**:
- Records user interactions (clicks, inputs, navigation)
- Captures element selectors and context
- Stores action sequences

### Action Replay

**Location**: `src/integrations/workshop/action-replay.ts`

**Purpose**: Replays captured actions

**Features**:
- Executes actions in sequence
- Validates element existence before replay
- Handles timing and delays

## Usage

The Workshop integration is typically used in development mode for:
- Creating interactive guides
- Testing action sequences
- Debugging interactive elements

## Integration Points

- **Dev Tools** (`src/utils/devtools/`) - Uses action recorder utilities
- **Interactive Engine** (`src/interactive-engine/`) - Executes replayed actions

## See Also

- `docs/developer/DEV_MODE.md` - Development mode documentation
- `src/utils/devtools/action-recorder.hook.ts` - Action recording hook

