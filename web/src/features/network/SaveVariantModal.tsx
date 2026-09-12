import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type { DraftChange } from './draft';
import { suggestedVariantTitle } from './draft';

interface SaveVariantModalProps {
  readonly changes: readonly DraftChange[];
  readonly parentTitle: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onSave: (title: string) => void;
}

/**
 * Сохранение черновика новым вариантом. Название по умолчанию собрано из первого отличия
 * — пользователь узнаёт вариант в списке, не открывая его (`14_SCREENS.md` §2.1).
 */
export function SaveVariantModal({
  changes,
  parentTitle,
  busy,
  error,
  onClose,
  onSave,
}: SaveVariantModalProps) {
  const [title, setTitle] = useState(() => suggestedVariantTitle(changes));

  return (
    <Modal
      title="Сохранить как вариант"
      subtitle={`Родитель: ${parentTitle}. Вариант неизменяем — дальнейшие правки создадут новый черновик.`}
      align="start"
      width={640}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={busy || title.trim() === ''} onClick={() => { onSave(title.trim()); }}>
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </>
      }
    >
      <label className="block">
        <span className="mb-[8px] block text-micro font-semibold uppercase tracking-[0.8px] text-ink-muted">
          Название
        </span>
        <input
          type="text"
          value={title}
          onChange={(event) => { setTitle(event.target.value); }}
          className="h-[48px] w-full rounded-sm border border-line bg-surface-input px-[15px] text-base text-ink-primary"
        />
      </label>

      <p className="mt-[20px] text-micro font-semibold uppercase tracking-[0.8px] text-ink-muted">
        Отличия от родителя · {changes.length}
      </p>
      <ul className="mt-[10px] space-y-[6px]">
        {changes.map((change) => (
          <li key={change.path} className="flex items-center gap-[10px] text-small text-ink-secondary">
            <span className="font-mono text-caption text-ink-primary">{change.path}</span>
            <span data-numeric>
              {change.from} → {change.to}
            </span>
          </li>
        ))}
      </ul>

      {error !== null && (
        <p role="alert" className="mt-[16px] text-small text-status-danger">
          {error}
        </p>
      )}
    </Modal>
  );
}
