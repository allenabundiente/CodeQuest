"use client";

import { cpp } from "@codemirror/lang-cpp";
import { go } from "@codemirror/lang-go";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { Compartment, EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import type { Language } from "@/lib/types";

export interface CodeMirrorEditorProps {
  value: string;
  language: Language;
  onChange: (value: string) => void;
  onRun: () => void;
  readOnly?: boolean;
}

function languageExtension(language: Language): Extension {
  switch (language) {
    case "python":
      return python();
    case "javascript":
      return javascript();
    case "typescript":
      return javascript({ typescript: true });
    case "java":
      return java();
    case "cpp":
      return cpp();
    case "go":
      return go();
    default:
      return [];
  }
}

const editorTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "transparent",
      color: "var(--text)",
      fontSize: "13px",
    },
    ".cm-content": {
      fontFamily: "var(--mono)",
      padding: "12px 0",
      minHeight: "280px",
      caretColor: "var(--accent)",
    },
    ".cm-scroller": {
      fontFamily: "var(--mono)",
      lineHeight: "1.55",
      maxHeight: "52vh",
      overflow: "auto",
    },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "#56697d",
      border: "none",
    },
    ".cm-activeLine": { backgroundColor: "rgba(124, 242, 156, 0.05)" },
    ".cm-activeLineGutter": {
      backgroundColor: "rgba(124, 242, 156, 0.06)",
      color: "var(--accent)",
    },
    ".cm-selectionBackground, ::selection": {
      backgroundColor: "rgba(127, 178, 255, 0.25) !important",
    },
    ".cm-cursor": { borderLeftColor: "var(--accent)" },
    "&.cm-focused": { outline: "none" },
  },
  { dark: true },
);

export function CodeMirrorEditor({
  value,
  language,
  onChange,
  onRun,
  readOnly = false,
}: CodeMirrorEditorProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const readOnlyCompartment = useRef(new Compartment());

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onRunRef.current = onRun;
  }, [onRun]);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        editorTheme,
        languageExtension(language),
        EditorView.contentAttributes.of({
          "aria-label": "Code editor",
          "aria-keyshortcuts": "Control+Enter Meta+Enter",
          spellcheck: "false",
        }),
        EditorView.lineWrapping,
        keymap.of([
          {
            key: "Mod-Enter",
            preventDefault: true,
            run: () => {
              onRunRef.current();
              return true;
            },
          },
        ]),
        readOnlyCompartment.current.of(EditorView.editable.of(!readOnly)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The document is synchronized below; recreating for a language change is
    // intentional so language parsing and history start clean.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(
        EditorView.editable.of(!readOnly),
      ),
    });
  }, [readOnly]);

  return <div className="cm-shell" ref={host} />;
}
