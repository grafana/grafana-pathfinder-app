/**
 * DnD Provider
 *
 * Provides @dnd-kit context for the block editor with properly configured
 * sensors and collision detection. This is the standard drag-and-drop
 * implementation for sortable items in this project.
 *
 * @see https://dndkit.com/
 */

import React, { useMemo, useRef } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  DragOverlay,
  MeasuringStrategy,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

/**
 * Data attached to draggable items
 */
export interface DragData {
  /** Type of item being dragged */
  type: 'root' | 'nested' | 'conditional' | 'step';
  /** Block type (e.g., 'markdown', 'section') for constraint checking */
  blockType?: string;
  /** For nested blocks: the parent section ID */
  sectionId?: string;
  /** For conditional blocks: the conditional ID and branch */
  conditionalId?: string;
  branch?: 'whenTrue' | 'whenFalse';
  /** Index within the container */
  index: number;
}

export interface DndProviderProps {
  /** Child components */
  children: React.ReactNode;
  /** Called when drag starts */
  onDragStart?: (event: DragStartEvent) => void;
  /** Called when dragging over a droppable */
  onDragOver?: (event: DragOverEvent) => void;
  /** Called when drag ends (drop) */
  onDragEnd: (event: DragEndEvent) => void;
  /** Called when drag is cancelled */
  onDragCancel?: () => void;
  /** Whether drag is disabled (e.g., in selection mode) */
  disabled?: boolean;
  /** Custom drag overlay content */
  dragOverlay?: React.ReactNode;
}

/**
 * Measuring configuration for @dnd-kit
 * Uses always measuring for accurate drop targets
 */
const measuringConfig = {
  droppable: {
    strategy: MeasuringStrategy.Always,
  },
};

/**
 * DnD Provider component
 *
 * Wraps children with @dnd-kit context configured with:
 * - PointerSensor with distance activation (prevents accidental drags)
 * - KeyboardSensor for accessibility
 * - closestCenter collision detection
 */
export function DndProvider({
  children,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDragCancel,
  disabled = false,
  dragOverlay,
}: DndProviderProps) {
  // Track if we're currently dragging to show overlay
  const isDraggingRef = useRef(false);

  // Configure sensors with activation constraints
  // Distance of 8px prevents accidental drags when clicking buttons
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: {
      distance: 8,
    },
  });

  // Keyboard sensor for accessibility (Tab, Space, Arrow keys)
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  });

  // Memoize sensors array
  const sensors = useSensors(pointerSensor, keyboardSensor);

  // Disabled sensors when in selection mode
  const activeSensors = useMemo(() => {
    return disabled ? [] : sensors;
  }, [disabled, sensors]);

  // Wrap handlers to track dragging state
  const handleDragStart = (event: DragStartEvent) => {
    isDraggingRef.current = true;
    onDragStart?.(event);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    isDraggingRef.current = false;
    onDragEnd(event);
  };

  const handleDragCancel = () => {
    isDraggingRef.current = false;
    onDragCancel?.();
  };

  return (
    <DndContext
      sensors={activeSensors}
      collisionDetection={closestCenter}
      measuring={measuringConfig}
      onDragStart={handleDragStart}
      onDragOver={onDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {children}
      {/* DragOverlay provides visual feedback during drag */}
      <DragOverlay dropAnimation={null}>{dragOverlay}</DragOverlay>
    </DndContext>
  );
}

DndProvider.displayName = 'DndProvider';
