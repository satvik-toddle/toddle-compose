import { useCallback } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useReactFlow,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AddOutlined } from '@toddle-edu/ds-icons';
import { Button } from '@toddle-edu/ds-web';
import { useRtcToken } from '../../../hooks/usePages';
import { useAuthStore } from '../../../stores/authStore';
import { useThemeStore } from '../../../stores/themeStore';
import { PageLoader } from '../../../components/Loader';
import { useYjsReactFlow, type FlowCursor } from './useYjsReactFlow';

const styles = {
  shell: 'flex-1 min-h-0 flex flex-col p-6',
  canvas: 'flex-1 min-h-0 overflow-hidden rounded-2 border border-secondary',
  message: 'flex-1 flex items-center justify-center text-body-s text-secondary',
  node: 'rounded-1 border border-secondary bg-[var(--panel-bg)] px-3 py-2 shadow-sm',
  nodeInput: 'w-32 bg-transparent text-body-s outline-none text-center',
};

type LabelNodeData = { label: string; readOnly?: boolean };

// The one node kind on this board: a card with an editable label. Edits go
// through updateNodeData, which surfaces as a 'replace' change in onNodesChange
// and syncs like any other node update. `readOnly` is stamped locally per client
// (never persisted) so viewers can't type.
function LabelNode({ id, data }: Readonly<NodeProps>) {
  const { updateNodeData } = useReactFlow();
  const { label, readOnly } = data as LabelNodeData;

  return (
    <div className={styles.node}>
      <input
        className={styles.nodeInput}
        value={label}
        readOnly={readOnly}
        placeholder="Label"
        onChange={(e) => updateNodeData(id, { label: e.target.value })}
      />
    </div>
  );
}

const NODE_TYPES = { label: LabelNode };
const DEFAULT_EDGE_OPTIONS = { markerEnd: { type: MarkerType.ArrowClosed } };

// Other clients' pointers, drawn in flow coordinates so they track pan/zoom.
function Cursors({ cursors }: Readonly<{ cursors: FlowCursor[] }>) {
  return (
    <ViewportPortal>
      {cursors.map((c) => (
        <div
          key={c.clientId}
          className="pointer-events-none absolute z-50 flex items-center gap-1"
          style={{ transform: `translate(${c.x}px, ${c.y}px)` }}
        >
          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />
          <span
            className="rounded-1 px-1 text-[10px] leading-4 text-white"
            style={{ backgroundColor: c.color }}
          >
            {c.name}
          </span>
        </div>
      ))}
    </ViewportPortal>
  );
}

type WhiteboardCanvasProps = { docId: string; token: string; canEdit: boolean };
type WhiteboardEditorProps = { docId: string };

// Inner canvas: binds React Flow's controlled state to Yjs for one synced board.
// Mounted (inside ReactFlowProvider) only once the RTC token is ready.
function WhiteboardCanvas({ docId, token, canEdit }: Readonly<WhiteboardCanvasProps>) {
  const user = useAuthStore((s) => s.user);
  const preference = useThemeStore((s) => s.preference);
  const { screenToFlowPosition } = useReactFlow();
  const { nodes, edges, cursors, synced, onNodesChange, onEdgesChange, onConnect, addNode, setCursor } =
    useYjsReactFlow({ docId, token, user });

  const onAddNode = useCallback(() => {
    const position = screenToFlowPosition({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * 80,
      y: window.innerHeight / 2 + (Math.random() - 0.5) * 80,
    });
    const node: Node = { id: crypto.randomUUID(), type: 'label', position, data: { label: '' } };
    addNode(node);
  }, [screenToFlowPosition, addNode]);

  if (!synced) {
    return (
      <div className={styles.shell}>
        <PageLoader />
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <div className={styles.canvas}>
        <ReactFlow
          nodes={nodes.map((n) => ({ ...n, data: { ...n.data, readOnly: !canEdit } }))}
          edges={edges}
          nodeTypes={NODE_TYPES}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          colorMode={preference}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onPaneMouseMove={(e) => setCursor(screenToFlowPosition({ x: e.clientX, y: e.clientY }))}
          onPaneMouseLeave={() => setCursor(null)}
          nodesDraggable={canEdit}
          nodesConnectable={canEdit}
          elementsSelectable={canEdit}
          edgesReconnectable={canEdit}
          deleteKeyCode={canEdit ? ['Backspace', 'Delete'] : null}
          proOptions={{ hideAttribution: false }}
          fitView
        >
          <Background />
          <Controls showInteractive={false} />
          <MiniMap />
          <Cursors cursors={cursors} />
          {canEdit && (
            <Panel position="top-left">
              <Button
                dsVersion="2.0"
                variant="neutral"
                type="fill"
                size="small"
                icon={<AddOutlined />}
                onClick={onAddNode}
              >
                Add node
              </Button>
            </Panel>
          )}
        </ReactFlow>
      </div>
    </div>
  );
}

// Real-time collaborative diagram board (WHITEBOARD_REACTFLOW page type): React
// Flow bound to Yjs via useYjsReactFlow. Keyed by docId at the call site; the
// RTC role drives editability (viewers get a read-only canvas).
export function ReactFlowEditor({ docId }: Readonly<WhiteboardEditorProps>) {
  const { data: rtc, isLoading, isError } = useRtcToken(docId);

  if (isError) {
    return <div className={styles.message}>Couldn&apos;t open this whiteboard.</div>;
  }

  if (isLoading || !rtc) {
    return (
      <div className={styles.shell}>
        <PageLoader />
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <WhiteboardCanvas docId={docId} token={rtc.token} canEdit={rtc.role === 'editor'} />
    </ReactFlowProvider>
  );
}
