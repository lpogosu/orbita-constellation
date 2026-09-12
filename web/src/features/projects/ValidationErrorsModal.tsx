import { ChevronRight, Download } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { formatCount } from '@/lib/format';
import type { ScenarioProblem } from './use-scenario-review';

interface ValidationErrorsModalProps {
  fileName: string;
  problems: readonly ScenarioProblem[];
  sourceText: string | null;
  onClose: () => void;
  onPickAnotherFile: () => void;
  onValidateText: (text: string) => void;
}

/** Встроенный просмотр JSON: диагностика остаётся рядом с исходным файлом. */
export function ValidationErrorsModal({
  fileName,
  problems,
  sourceText,
  onClose,
  onPickAnotherFile,
  onValidateText,
}: ValidationErrorsModalProps) {
  const [activeProblem, setActiveProblem] = useState(0);
  const [editorText, setEditorText] = useState(sourceText ?? '');
  const [editorScrollTop, setEditorScrollTop] = useState(0);
  const editor = useRef<HTMLTextAreaElement>(null);
  const sourceLines = useMemo(
    () =>
      sourceText === null && editorText === ''
        ? ['// Исходный текст недоступен: используйте описание ошибки справа.']
        : editorText.split(/\r?\n/),
    [editorText, sourceText],
  );
  const activeLine = findProblemLine(sourceLines, problems[activeProblem]);

  const focusProblem = useCallback((index: number) => {
    setActiveProblem(index);
    const line = findProblemLine(editorText.split(/\r?\n/), problems[index]);
    if (line === null || editor.current === null) {
      return;
    }
    const lines = editorText.split(/\r?\n/);
    const start = lines.slice(0, line - 1).reduce((offset, value) => offset + value.length + 1, 0);
    const end = start + (lines[line - 1]?.length ?? 0);
    editor.current.focus();
    editor.current.setSelectionRange(start, end);
    const scrollTop = Math.max(0, (line - 4) * 20);
    editor.current.scrollTop = scrollTop;
    setEditorScrollTop(scrollTop);
  }, [editorText, problems]);

  return (
    <Modal
      title="Сценарий содержит ошибки"
      subtitle={
        <>
          <span className="font-mono text-small">{fileName}</span>
          <span className="mx-2 text-ink-muted">·</span>
          <span className="text-status-danger">
            {formatCount(problems.length, 'ошибка', 'ошибки', 'ошибок')}
          </span>
        </>
      }
      align="start"
      width={1420}
      scrollBody={false}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              downloadReport(fileName, problems);
            }}
            icon={<Download aria-hidden="true" className="size-5" />}
          >
            Скачать отчёт
          </Button>
          <span className="ml-auto flex gap-4">
            <Button variant="secondary" onClick={onClose}>
              Отмена
            </Button>
            <Button
              onClick={() => {
                onValidateText(editorText);
              }}
              iconAfter={<ChevronRight aria-hidden="true" className="size-5" />}
            >
              Проверить и продолжить
            </Button>
          </span>
        </>
      }
    >
      <div className="grid h-[470px] grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)] gap-4">
        <section
          aria-label="Исходный JSON"
          className="overflow-hidden rounded-xl border border-line bg-[rgba(6,13,42,0.86)]"
        >
          <div className="flex h-[38px] items-center gap-4 border-b border-line-divider bg-surface-sunken px-4">
            <span className="font-mono text-caption font-semibold text-ink-primary">{fileName}</span>
            <span className="text-micro font-semibold uppercase tracking-wide text-accent-blue">JSON</span>
          </div>
          <div className="relative h-[432px] overflow-hidden">
            <ol
              aria-hidden="true"
              className="pointer-events-none absolute left-0 top-0 z-10 w-11 border-r border-line-divider bg-[rgba(6,13,42,0.95)] py-2 font-mono text-[12px] leading-5"
              style={{ transform: `translateY(${-editorScrollTop}px)` }}
            >
              {sourceLines.map((line, index) => (
                <li
                  key={`${index}-${line}`}
                  className={index + 1 === activeLine ? 'bg-status-danger-soft text-ink-primary' : 'text-ink-muted'}
                >
                  <span className="block pr-3 text-right">{index + 1}</span>
                </li>
              ))}
            </ol>
            <textarea
              ref={editor}
              aria-label="Редактор исходного JSON"
              spellCheck={false}
              value={editorText}
              onChange={(event) => {
                setEditorText(event.target.value);
              }}
              onScroll={(event) => {
                setEditorScrollTop(event.currentTarget.scrollTop);
              }}
              className="scroll-area h-full w-full resize-none bg-transparent py-2 pl-[54px] pr-4 font-mono text-[12px] leading-5 text-ink-primary caret-accent-blue outline-none selection:bg-status-danger-soft"
            />
          </div>
        </section>

        <section
          aria-label="Список ошибок"
          className="overflow-hidden rounded-xl border border-line bg-surface-raised"
        >
          <div className="flex h-[38px] items-center justify-between border-b border-line-divider px-4">
            <h3 className="text-small font-semibold text-ink-primary">Ошибки</h3>
            <button
              type="button"
              onClick={onPickAnotherFile}
              className="text-caption font-semibold text-accent-blue transition-colors hover:text-ink-primary"
            >
              Другой файл
            </button>
          </div>
          <ol className="scroll-area h-[432px] space-y-2 p-3">
            {problems.map((problem, index) => (
              <li key={`${problem.path ?? 'нет поля'}-${index}`}>
                <button
                  type="button"
                  onClick={() => { focusProblem(index); }}
                  aria-pressed={activeProblem === index}
                  className={
                    activeProblem === index
                      ? 'w-full rounded-lg border border-status-danger bg-status-danger-soft p-3 text-left'
                      : 'w-full rounded-lg border border-line-divider bg-surface-sunken p-3 text-left transition-colors hover:border-line-strong'
                  }
                >
                  <span className="flex items-start gap-2">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-pill bg-status-danger text-[11px] font-bold text-ink-onAccent">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-all font-mono text-caption font-semibold text-ink-primary">
                        {problem.path ?? 'Файл целиком'}
                      </span>
                      <span className="mt-1 block text-caption leading-5 text-ink-secondary">
                        {problem.message}
                      </span>
                      {problem.value !== undefined && (
                        <span className="mt-1 block break-all font-mono text-micro text-ink-muted">
                          получено: {JSON.stringify(problem.value)}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </Modal>
  );
}

function findProblemLine(lines: readonly string[], problem: ScenarioProblem | undefined): number | null {
  if (problem?.path === null || problem?.path === undefined) {
    return null;
  }
  const parts = problem.path.match(/[A-Za-z_][A-Za-z0-9_]*/g);
  const field = parts?.[parts.length - 1];
  if (field === undefined) {
    return null;
  }
  const line = lines.findIndex((item) => item.includes(`"${field}"`));
  return line === -1 ? null : line + 1;
}

function downloadReport(fileName: string, problems: readonly ScenarioProblem[]): void {
  const lines = [
    `Сценарий: ${fileName}`,
    `Проверка: ${new Date().toISOString()}`,
    `Ошибок: ${problems.length}`,
    '',
    ...problems.map((problem, index) =>
      [
        `${index + 1}. ${problem.path ?? 'файл целиком'}`,
        `   ${problem.message}`,
        problem.code === null ? null : `   код: ${problem.code}`,
        problem.value === undefined ? null : `   получено: ${JSON.stringify(problem.value)}`,
      ]
        .filter((line): line is string => line !== null)
        .join('\n'),
    ),
  ];

  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileName}.errors.txt`;
  link.click();
  URL.revokeObjectURL(url);
}
