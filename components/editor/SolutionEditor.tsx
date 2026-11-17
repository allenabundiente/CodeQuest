"use client";

import dynamic from "next/dynamic";
import type { CodeMirrorEditorProps } from "./CodeMirrorEditor";

const CodeMirrorEditor = dynamic(
  () =>
    import("./CodeMirrorEditor").then((module) => module.CodeMirrorEditor),
  {
    ssr: false,
    loading: () => (
      <div className="editor-loading" role="status">
        Loading editor…
      </div>
    ),
  },
);

export function SolutionEditor(props: CodeMirrorEditorProps) {
  return <CodeMirrorEditor {...props} />;
}
