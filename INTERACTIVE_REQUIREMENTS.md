# Interactive Elements Requirements System

This document describes the requirements system for interactive elements in the Grafana Documentation Plugin.

## Overview

Interactive elements in documentation content can have both **explicit requirements** and **implicit requirements** that must be satisfied before they can be executed.

## Explicit Requirements

Explicit requirements are declared in the `data-requirements` attribute of interactive elements. Multiple requirements are comma-separated.

### Supported Explicit Requirements

#### `exists-reftarget`
- **Purpose**: Ensures the target element exists in the DOM before the interactive action can be executed
- **Usage**: Most common requirement for interactive elements
- **Example**: `data-requirements="exists-reftarget"`

#### `has-datasources`
- **Purpose**: Ensures that Grafana has at least one configured data source
- **Usage**: For interactive elements that require data sources to function
- **Example**: `data-requirements="has-datasources"`

### Combining Requirements

Multiple requirements can be combined:
```html
<button data-requirements="exists-reftarget,has-datasources" 
        data-targetaction="button" 
        data-reftarget="Add Dashboard">
  Click to add dashboard
</button>
```

## Implicit Requirements

Implicit requirements are automatically enforced by the system and do not need to be declared in HTML.

### Dual Workflow System

The requirements system recognizes two types of workflows:

1. **Regular Workflow**: Traditional sequential steps using "Show Me" and "Do It" buttons
   - Follow strict sequential dependency rules
   - Only one step enabled at a time within the workflow
   - Steps must be completed in order

2. **Section Workflows**: Independent parent-level workflows using "Do Section" buttons
   - Each "do section" button is its own separate workflow
   - Eligible for "Trust but Verify" treatment independently
   - Can be enabled simultaneously with regular workflow steps
   - Function as parent containers for sequences of interactive steps

This dual system allows for both structured tutorials (regular workflow) and independent section-level actions (section workflows) to coexist and function properly.

### 1. Sequential Dependency

**Rule**: If button `n` is not enabled because its requirements are not satisfied, no later buttons in the sequence may be enabled.

**Rationale**: Instructions are sequential, and it makes no sense to allow a person to take step 3 when step 2 is not yet satisfied or cannot be satisfied.

**Implementation**:
- Interactive elements are processed in DOM order
- When an element fails its requirements check, all subsequent elements are automatically disabled
- Short-circuit optimization: remaining elements are not checked once one fails
- Visual state: `requirements-disabled` class with dimmed appearance

**Example Flow**:
```
Step 1: ✅ Requirements met → Enabled
Step 2: ❌ Requirements failed → Disabled  
Step 3: 🚫 Auto-disabled (previous step failed)
Step 4: 🚫 Auto-disabled (previous step failed)
```

### 2. Completion State

**Rule**: If a button has already been clicked and its action completed, then it should become disabled.

**Rationale**: Prevents users from accidentally re-executing completed steps and provides clear visual feedback about progress.

**Implementation**:
- When an interactive action completes successfully, the element is marked with `data-completed="true"`
- Completed elements are automatically disabled during requirements checking
- Visual state: `requirements-completed` class with green background and checkmark
- Button text is appended with "✓" to indicate completion

**Example States**:
```
Before: [Do it]
After:  [Do it ✓] (disabled, green background)
```

### 3. One Step At A Time

**Rule**: In a given flow of interactive elements, only one element should be enabled. Elements subsequent to 
that, which is the "next step" in the flow, should always be disabled.

**Rationale**: Flows are designed as a set of sequential steps, and we don't want users to be allowed to 
execute step 4, if step 3 hasn't been done yet.

**Implementation**:
- Interactive elements are processed in DOM order
- Only the first non-completed element gets requirements checking
- All subsequent elements are fast-disabled without requirements checking
- When the current step is completed, the next step becomes the new current step
- Visual state: subsequent elements use `requirements-disabled` class

**Performance Optimization**: The system only performs expensive requirements checking on ONE element per run:
- Completed elements: fast-disabled without requirements check
- Future elements: fast-disabled without requirements check  
- Current element: the only one that gets requirements checking

**Example Flow**:
```
Step 1: ✅ Completed → Disabled (already done)
Step 2: 🔍 Current → Requirements checked and enabled/disabled based on result
Step 3: 🚫 Future → Fast-disabled (One Step at a Time)
Step 4: 🚫 Future → Fast-disabled (One Step at a Time)
```

### 4. Trust But Verify the First Step

**Rule**: The first step of an interactive workflow is always enabled,
provided that its requirements have been met, when no other step has 
been completed. 

**Rationale**: The user has to have a place to start. The code will trust 
that the very first step of an interactive workflow can always be accomplished.
The "One Step at a Time" rule means that the previous step must always succeed
before a step becomes enabled; the issue is that first steps don't have 
previous steps. Therefore, this rule is a **special exception** to the 
"One Step at a Time" rule. This rule does not exempt the first step from
requirements checking, which must be done as a precondition for enabling any
step.

## Logical Step Grouping

**Concept**: Interactive elements with the same `data-reftarget` and `data-targetaction` attributes belong to the same logical step, regardless of their button type (`show` vs `do`).
There is a special exception: the "do section" button or similar, which wraps together a 
whole sequence of interactive steps, is its own separate workflow. Such "do section" buttons
should be considered separately, as the parent of the individual steps.  If an interactive
guide is to have more than one section, the "do section" grouping buttons function according
to the same set of rules as any interactive section, as described in this document.

**Implementation**: 
- "Show Me" and "Do It" buttons for the same action are grouped together
- Requirements checking applies to the entire step, not individual buttons
- When any button in a step completes, the entire step is marked as completed
- All buttons in a step share the same enabled/disabled state
- **SPECIAL EXCEPTION**: "Do section" buttons (`data-targetaction="sequence"`) are always treated as separate logical steps, regardless of their `reftarget` matching other elements

**Example**:
```html
<!-- These buttons belong to the same logical step -->
<button data-reftarget="Save Dashboard" data-targetaction="button" data-button-type="show">Show me</button>
<button data-reftarget="Save Dashboard" data-targetaction="button" data-button-type="do">Do it</button>

<!-- This "do section" button is its own separate logical step -->
<button data-reftarget="Save Dashboard" data-targetaction="sequence" data-button-type="do">Do SECTION</button>

<!-- Even if multiple section buttons have the same reftarget, they are separate steps -->
<button data-reftarget="Save Dashboard" data-targetaction="sequence" data-button-type="do">Do SECTION</button>
```

In this example:
- **Regular Workflow**: Show me/Do it buttons for "Save Dashboard" (grouped together, follows sequential rules)
- **Section Workflow A**: First "do section" button (independent workflow, eligible for Trust but Verify)
- **Section Workflow B**: Second "do section" button (independent workflow, eligible for Trust but Verify)

**Processing Logic**:
- Regular workflow: Only one step enabled at a time (sequential dependency)
- Section workflows: Each eligible section button can be enabled independently (Trust but Verify)
- Both workflows can have enabled steps simultaneously
- Completion tracking works independently for each workflow

**Benefits**:
- Consistent user experience across Show/Do buttons
- Performance optimization (only one requirements check per step)
- Logical completion tracking (clicking either button completes the step)
- Clear visual feedback for step progression

## Element States

The requirements system manages several visual states:

### State Classes

| Class | Description | Button State | Visual Appearance |
|-------|-------------|--------------|-------------------|
| `requirements-checking` | Requirements being validated | Enabled | Loading spinner |
| `requirements-satisfied` | All requirements met | Enabled | Normal appearance |
| `requirements-failed` | Explicit requirements not met | Disabled | Dimmed, error tooltip |
| `requirements-disabled` | Disabled due to sequential dependency | Disabled | Very dimmed |
| `requirements-completed` | Action already completed | Disabled | Green background, checkmark |

### State Transitions

```
Initial → Checking → (Satisfied|Failed|Disabled|Completed)
                      ↓
                   Enabled/Disabled
```

## Technical Implementation

### DOM Attributes

- `data-requirements`: Comma-separated list of explicit requirements
- `data-completed`: Set to "true" when action is completed (implicit requirement #2)
- `data-original-text`: Stores original button text for restoration

### CSS Classes

All requirement states use the `requirements-*` class pattern for consistent styling.

### Processing Order

1. **Element Discovery**: Find all elements with `[data-requirements]` in DOM order
2. **Completion Check**: Skip if `data-completed="true"` (implicit requirement #2)
3. **Sequential Check**: Disable if previous element failed (implicit requirement #1)
4. **Explicit Check**: Validate declared requirements
5. **State Update**: Apply appropriate visual state

### Short-Circuit Optimization

When using sequential mode, the system stops checking requirements as soon as one element fails, automatically disabling all subsequent elements. This provides:

- **Performance**: Avoids unnecessary requirement checks
- **User Experience**: Clear indication that previous steps must be completed
- **Logical Flow**: Enforces step-by-step progression

## Usage Examples

### Basic Interactive Element
```html
<span class="interactive" 
      data-targetaction="button" 
      data-reftarget="Save Dashboard" 
      data-requirements="exists-reftarget">
  Click the Save Dashboard button
</span>
```

### Sequential Tutorial Steps
```html
<!-- Step 1: Will be checked first -->
<button data-requirements="has-datasources" 
        data-targetaction="button" 
        data-reftarget="Add Panel">
  Add a new panel
</button>

<!-- Step 2: Only enabled if Step 1 succeeds -->
<button data-requirements="exists-reftarget" 
        data-targetaction="formfill" 
        data-reftarget="#panel-title" 
        data-targetvalue="My Panel">
  Set panel title
</button>

<!-- Step 3: Only enabled if Step 2 succeeds -->
<button data-requirements="exists-reftarget" 
        data-targetaction="button" 
        data-reftarget="Apply">
  Apply changes
</button>
```

### Completion Tracking

When Step 1 completes:
```html
<!-- Automatically updated by the system -->
<button data-requirements="has-datasources" 
        data-targetaction="button" 
        data-reftarget="Add Panel"
        data-completed="true"
        class="requirements-completed">
  Add a new panel ✓
</button>
```

## Configuration

### Sequential Mode (Default)
```typescript
await checkAllElementRequirements(container, checkFn, true);
```

### Parallel Mode (Legacy)
```typescript
await checkAllElementRequirements(container, checkFn, false);
```

Sequential mode is recommended for tutorial-style content where step order matters. Parallel mode can be used for independent interactive elements that don't depend on each other.

## Error Handling

- **Unknown Requirements**: Elements with unsupported requirements are marked as failed
- **Requirement Check Errors**: Network or validation errors mark elements as failed
- **Missing Elements**: Elements that can't be found are marked as failed
- **Graceful Degradation**: System continues processing other elements when individual checks fail

## Accessibility

The requirements system includes accessibility features:

- **ARIA Attributes**: `aria-disabled` reflects button state
- **Tooltips**: Disabled buttons show reason via `title` attribute
- **Visual Indicators**: Color and opacity changes provide visual feedback
- **Screen Readers**: State changes are announced through ARIA attributes

## Migration Guide

Existing code using the old requirements system can be migrated to use the new unified system:

```typescript
// Old approach (duplicated logic)
const checkAllRequirements = async () => {
  // ... custom implementation
};

// New approach (unified utility)
import { checkAllElementRequirements } from './utils/requirements.util';

const result = await checkAllElementRequirements(
  contentRef.current,
  checkElementRequirements,
  true // Enable sequential mode
);
```

This provides the same functionality with the addition of implicit requirements and improved performance. 