"use client";

import { useMemo, useState } from "react";

function isBlank(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return (
    /TODO/i.test(trimmed) ||
    trimmed === "pass" ||
    trimmed === "..." ||
    trimmed === "// your code here" ||
    trimmed === "# your code here"
  );
}

/**
 * Mobile-first blocks view. Generated lessons ship scaffolds with TODO lines,
 * so each TODO becomes a fill-in block; everything else stays read-only. That
 * keeps small screens from forcing full-file editing while using the same
 * lesson content and grading API as the desktop editor.
 */
export function GuidedEditor({
  code,
  onChange,
  onRun,
  readOnly,
  onUseCode,
}: {
  code: string;
  onChange: (value: string) => void;
  onRun: () => void;
  readOnly: boolean;
  onUseCode: () => void;
}) {
  const lines = useMemo(() => code.split("\n"), [code]);
  const blanks = useMemo(
    () => lines.map((line, index) => (isBlank(line) ? index : -1)).filter((index) => index >= 0),
    [lines],
  );
  const [values, setValues] = useState<Record<number, string>>(() =>
    Object.fromEntries(blanks.map((index) => [index, lines[index]])),
  );

  if (blanks.length === 0) {
    return (
      <div className="guided-empty">
        <p className="small muted">
          This step has no TODO fill-ins. Use the full code editor for it.
        </p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onUseCode}>
          Open full editor
        </button>
      </div>
    );
  }

  function updateLine(index: number, value: string) {
    const nextValues = { ...values, [index]: value };
    setValues(nextValues);
    onChange(
      lines.map((line, lineIndex) => nextValues[lineIndex] ?? line).join("\n"),
    );
  }

  return (
    <div className="guided-editor">
      <div className="guided-blocks">
        {lines.map((line, index) => {
          const blank = blanks.includes(index);
          if (blank) {
            return (
              <label className="guided-block guided-fill" key={index}>
                <span className="guided-line">Line {index + 1} · fill in</span>
                <input
                  className="guided-input"
                  value={values[index] ?? line}
                  onChange={(event) => updateLine(index, event.target.value)}
                  spellCheck={false}
                  disabled={readOnly}
                  aria-label={`Fill in line ${index + 1}`}
                />
              </label>
            );
          }
          return (
            <pre className="guided-block" key={index}>
              {line || " "}
            </pre>
          );
        })}
      </div>
      <div className="guided-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={onRun}
          disabled={readOnly}
        >
          {readOnly ? "Running…" : "Check answer"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onUseCode}>
          Full editor
        </button>
      </div>
    </div>
  );
}
