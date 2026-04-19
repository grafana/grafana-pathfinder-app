/**
 * LearningGraph — React Flow canvas root.
 *
 * Wires together all hooks and sub-components:
 * - Fetches graph.json via useGraphData
 * - Manages filter state via useGraphFilters
 * - Computes Dagre layout via useGraphLayout
 * - Renders React Flow canvas with custom nodes and edges
 * - Shows node detail tooltip on click
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  Background,
  BackgroundVariant,
  MiniMap,
  useReactFlow,
  type Node as RFNode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useStyles2, Spinner, Alert } from '@grafana/ui';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

import type { GraphNode } from '../../types/package.types';
import { useGraphData } from './hooks/useGraphData';
import { useGraphFilters } from './hooks/useGraphFilters';
import { useGraphLayout } from './hooks/useGraphLayout';
import {
  GuideNode,
  PathNode,
  LearningGraphEdge,
  LearningGraphTooltip,
  LearningGraphFilters,
  type GraphNodeData,
} from './components';

// ============ REACT FLOW CONFIGURATION ============

const NODE_TYPES = {
  guideNode: GuideNode,
  pathNode: PathNode,
};

const EDGE_TYPES = {
  learningEdge: LearningGraphEdge,
};

// ============ STYLES ============

function getStyles(theme: GrafanaTheme2) {
  return {
    wrapper: css({
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      height: 480,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      overflow: 'hidden',
      background: theme.colors.background.canvas,
    }),
    canvas: css({
      flex: 1,
      minHeight: 0,
    }),
    center: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      gap: theme.spacing(1),
      color: theme.colors.text.secondary,
    }),
    emptyState: css({
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      gap: theme.spacing(1),
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
    }),
    resetLink: css({
      cursor: 'pointer',
      textDecoration: 'underline',
      background: 'none',
      border: 'none',
      color: 'inherit',
      fontSize: 'inherit',
    }),
  };
}

// ============ AUTO FIT VIEW ============

function AutoFitView({ nodeCount }: { nodeCount: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const id = setTimeout(() => fitView({ padding: 0.1, duration: 300 }), 50);
    return () => clearTimeout(id);
  }, [nodeCount, fitView]);
  return null;
}

// ============ INNER CANVAS (needs ReactFlowProvider context) ============

interface InnerCanvasProps {
  graphUrl: string;
  completedGuides: string[];
  onOpenGuide: (url: string, title: string) => void;
}

function InnerCanvas({ graphUrl, completedGuides, onOpenGuide }: InnerCanvasProps) {
  const styles = useStyles2(getStyles);
  const { graph, status, error } = useGraphData(graphUrl);

  const {
    filters,
    filteredGraph,
    availableCategories,
    toggleEdgeType,
    setTypeFilter,
    toggleCategory,
    setCompletionFilter,
    toggleWhatsNext,
    togglePathExpanded,
    resetFilters,
  } = useGraphFilters(graph, completedGuides);

  const { nodes: layoutNodes, edges: layoutEdges } = useGraphLayout(filteredGraph, completedGuides);

  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  // Inject interaction callbacks into node data
  const enrichedNodes = useMemo<RFNode[]>(() => {
    return layoutNodes.map((n) => ({
      ...n,
      data: {
        ...(n.data as GraphNodeData),
        isExpanded: filters.expandedPaths.has(n.id),
        onToggleExpand: togglePathExpanded,
        onNodeClick: setSelectedNode,
      } satisfies GraphNodeData,
    }));
  }, [layoutNodes, filters.expandedPaths, togglePathExpanded]);

  if (status === 'loading') {
    return (
      <div className={styles.center}>
        <Spinner size="lg" />
        <span>Loading learning map…</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <Alert title="Could not load learning map" severity="warning">
        {error ?? 'Unknown error'}
      </Alert>
    );
  }

  if (status === 'success' && (!filteredGraph || filteredGraph.nodes.length === 0)) {
    return (
      <div className={styles.emptyState}>
        <span>No guides match the current filters.</span>
        <button className={styles.resetLink} onClick={resetFilters}>
          Reset filters
        </button>
      </div>
    );
  }

  return (
    <>
      <LearningGraphFilters
        filters={filters}
        availableCategories={availableCategories}
        onToggleEdgeType={toggleEdgeType}
        onSetTypeFilter={setTypeFilter}
        onToggleCategory={toggleCategory}
        onSetCompletionFilter={setCompletionFilter}
        onToggleWhatsNext={toggleWhatsNext}
        onResetFilters={resetFilters}
      />

      <div className={styles.canvas}>
        <ReactFlow
          nodes={enrichedNodes}
          edges={layoutEdges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.1 }}
          minZoom={0.3}
          maxZoom={2}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={true}
          proOptions={{ hideAttribution: true }}
        >
          <AutoFitView nodeCount={enrichedNodes.length} />
          <Controls showInteractive={false} />
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <MiniMap nodeStrokeWidth={3} zoomable pannable />
        </ReactFlow>
      </div>

      {selectedNode && (
        <LearningGraphTooltip
          node={selectedNode}
          isCompleted={completedGuides.includes(selectedNode.id)}
          onClose={() => setSelectedNode(null)}
          onOpenGuide={onOpenGuide}
        />
      )}
    </>
  );
}

// ============ PUBLIC COMPONENT ============

interface LearningGraphProps {
  graphUrl: string;
  completedGuides: string[];
  onOpenGuide: (url: string, title: string) => void;
}

export function LearningGraph({ graphUrl, completedGuides, onOpenGuide }: LearningGraphProps) {
  const styles = useStyles2(getStyles);

  return (
    <ReactFlowProvider>
      <div className={styles.wrapper}>
        <InnerCanvas graphUrl={graphUrl} completedGuides={completedGuides} onOpenGuide={onOpenGuide} />
      </div>
    </ReactFlowProvider>
  );
}
