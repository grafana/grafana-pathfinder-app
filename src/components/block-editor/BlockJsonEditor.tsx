/**
 * BlockJsonEditor Component
 *
 * JSON code editor for directly editing guide content.
 * Displays validation errors inline and provides syntax highlighting.
 * Supports undo to revert all changes made in JSON mode.
 */

import React, { useRef, useEffect } from 'react';
import { Alert, Button, CodeEditor, useStyles2 } from '@grafana/ui';
import type { BlockJsonEditorProps } from './types';
import { getStyles } from './block-json-editor.styles';

// Monaco types (imported dynamically via onEditorDidMount)
type MonacoEditor = Parameters<NonNullable<React.ComponentProps<typeof CodeEditor>['onEditorDidMount']>>[0];
type Monaco = Parameters<NonNullable<React.ComponentProps<typeof CodeEditor>['onEditorDidMount']>>[1];

export function BlockJsonEditor({
  jsonText,
  onJsonChange,
  validationErrors,
  isValid,
  canUndo,
  onUndo,
}: BlockJsonEditorProps) {
  const styles = useStyles2(getStyles);
  const editorRef = useRef<MonacoEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  const handleEditorMount = (editor: MonacoEditor, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
  };

  // REACT: Update Monaco markers when errors change, cleanup on unmount (R1)
  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;

    if (!monaco || !editor) {
      return;
    }

    const model = editor.getModel();
    if (!model) {
      return;
    }

    // Create markers for errors with positions (positions will be added in Part 2)
    const markers = validationErrors
      .filter((e) => typeof e === 'object' && 'line' in e && e.line !== undefined)
      .map((e) => {
        const errorObj = e as { message: string; line: number; column?: number };
        return {
          severity: monaco.MarkerSeverity.Error,
          message: errorObj.message,
          startLineNumber: errorObj.line,
          startColumn: errorObj.column ?? 1,
          endLineNumber: errorObj.line,
          endColumn: model.getLineMaxColumn(errorObj.line),
        };
      });

    monaco.editor.setModelMarkers(model, 'json-validation', markers);

    // REACT: cleanup markers on unmount or when errors change (R1)
    return () => {
      if (monacoRef.current && editorRef.current) {
        const currentModel = editorRef.current.getModel();
        if (currentModel) {
          monacoRef.current.editor.setModelMarkers(currentModel, 'json-validation', []);
        }
      }
    };
  }, [validationErrors]);

  // Format error messages for Alert display
  const errorMessages = validationErrors.map((e) => {
    if (typeof e === 'object' && 'line' in e && e.line !== undefined) {
      const errorObj = e as { message: string; line: number };
      return `Line ${errorObj.line}: ${errorObj.message}`;
    }
    return typeof e === 'string' ? e : (e as { message: string }).message;
  });

  return (
    <div className={styles.container} data-testid="block-json-editor">
      {/* Toolbar with undo button */}
      {canUndo && onUndo && (
        <div className={styles.toolbar}>
          <Button
            variant="secondary"
            icon="history-alt"
            onClick={onUndo}
            size="sm"
            aria-label="Revert all changes made in JSON mode"
          >
            Revert changes
          </Button>
        </div>
      )}

      {!isValid && errorMessages.length > 0 && (
        <Alert severity="error" title="Invalid JSON">
          <ul className={styles.errorList}>
            {errorMessages.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </Alert>
      )}
      <div className={styles.editorContainer}>
        <CodeEditor
          value={jsonText}
          language="json"
          onBlur={onJsonChange}
          onEditorDidMount={handleEditorMount}
          showLineNumbers
          showMiniMap={false}
          height="100%"
        />
      </div>
    </div>
  );
}

BlockJsonEditor.displayName = 'BlockJsonEditor';
