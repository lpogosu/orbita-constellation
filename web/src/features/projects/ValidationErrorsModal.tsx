import { ChevronRight, Download } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { formatCount } from '@/lib/format';
import type { ScenarioProblem } from './use-scenario-review';

interface ValidationErrorsModalProps {
  fileName: string;
  problems: readonly ScenarioProblem[];
  onClose: () => void;
  onPickAnotherFile: () => void;
  onRecheck: () => void;
}

/**
 * Модал ошибок валидации (14_SCREENS.md §1.3). Показывает все ошибки списком, а не
 * первую: сервис возвращает их разом ровно ради того, чтобы файл правился за один проход.
 */
export function ValidationErrorsModal({
  fileName,
  problems,
  onClose,
  onPickAnotherFile,
  onRecheck,
}: ValidationErrorsModalProps) {
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
      hero={
        <img
          src="/assets/mascot-error.png"
          alt=""
          className="w-[220px] drop-shadow-[0_10px_30px_rgba(255,92,124,0.35)]"
        />
      }
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
          <Button variant="secondary" onClick={onPickAnotherFile}>
            Выбрать другой файл
          </Button>
          <Button
            onClick={onRecheck}
            iconAfter={<ChevronRight aria-hidden="true" className="size-5" />}
          >
            Повторить проверку
          </Button>
        </>
      }
    >
      <ol className="space-y-2.5">
        {problems.map((problem, index) => (
          <li
            key={`${problem.path ?? 'нет поля'}-${index}`}
            className="flex items-start gap-3.5 rounded-md border-l-2 border-status-danger bg-surface-sunken px-4 py-3"
          >
            <span
              aria-hidden="true"
              className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-pill bg-status-danger text-caption font-bold text-ink-onAccent"
            >
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="break-all font-mono text-small font-semibold text-ink-primary">
                {problem.path ?? 'Файл целиком'}
              </p>
              <p className="mt-0.5 text-small text-ink-secondary">
                {problem.message}
                {problem.value !== undefined && (
                  <span className="ml-2 rounded-sm bg-surface-chip px-2 py-0.5 font-mono text-caption text-ink-muted">
                    получено: {JSON.stringify(problem.value)}
                  </span>
                )}
              </p>
            </div>
            {problem.code !== null && (
              <span className="shrink-0 rounded-pill border border-status-danger px-2.5 py-1 font-mono text-[10px] uppercase text-status-danger">
                {problem.code}
              </span>
            )}
          </li>
        ))}
      </ol>
    </Modal>
  );
}

/** Текстовый отчёт со списком ошибок: его удобно приложить к письму или задаче. */
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
