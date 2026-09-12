import { FileText, FolderOpen } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { cx } from '@/lib/cx';

interface DropzoneCardProps {
  onFile: (file: File) => void;
  /** Открыть системный диалог выбора файла; сам `input` живёт на странице. */
  onBrowse: () => void;
  /** Прокрутка к примерам: вторая кнопка макета ведёт к тем же четырём карточкам. */
  onShowExamples: () => void;
}

/** Card / Dropzone: маскот, заголовок, кнопка выбора файла и переход к примерам. */
export function DropzoneCard({ onFile, onBrowse, onShowExamples }: DropzoneCardProps) {
  const [dragging, setDragging] = useState(false);

  return (
    <Card
      className={cx(
        'min-h-[498px] transition-colors duration-150',
        dragging && 'border-line-strong shadow-glow-blue',
      )}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => {
        setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file !== undefined) {
          onFile(file);
        }
      }}
    >
      <div
        aria-hidden="true"
        className={cx(
          'pointer-events-none absolute inset-[15px] rounded-xl border-2 border-dashed transition-colors duration-150',
          dragging ? 'border-accent-blue' : 'border-line',
        )}
      />

      <div className="relative flex min-h-[498px] items-center gap-6 px-[39px] py-10 2xl:gap-10">
        <figure className="relative w-[260px] shrink-0 2xl:w-[396px]">
          <img
            src="/assets/mascot-json.png"
            alt="Спутник-маскот ОРБИТЫ держит файл сценария"
            className="w-full"
          />
          <figcaption className="mt-2 -rotate-[4deg] pl-3 font-script text-[24px] leading-[1.12] tracking-[0.4px] text-ink-secondary 2xl:pl-6 2xl:text-[30px]">
            Те же возможности.
            <br />
            Больше открытий!
          </figcaption>
        </figure>

        <div className="min-w-0 flex-1">
          <h2 className="text-[26px] font-bold leading-[1.2] tracking-[-0.4px] text-ink-primary 2xl:text-heading-m">
            Загрузите сценарий JSON
          </h2>
          <p className="mt-3 max-w-[36ch] text-body text-ink-secondary 2xl:text-title-l">
            {dragging ? 'Отпустите файл — начнётся проверка.' : 'Перетащите файл сюда или выберите его на компьютере.'}
          </p>

          <Button
            variant="magenta"
            size="l"
            className="mt-8 w-[483px] max-w-full"
            icon={<FolderOpen aria-hidden="true" className="size-6" />}
            onClick={onBrowse}
          >
            Выбрать JSON
          </Button>

          <div className="mt-7 flex w-[485px] max-w-full items-center gap-4 text-body text-ink-muted">
            <span className="h-px flex-1 bg-line-divider" />
            или
            <span className="h-px flex-1 bg-line-divider" />
          </div>

          <Button
            variant="secondary"
            size="l"
            className="mt-6 h-[66px] w-[339px] max-w-full"
            icon={<FileText aria-hidden="true" className="size-6" />}
            onClick={onShowExamples}
          >
            Примеры сценариев
          </Button>
        </div>
      </div>
    </Card>
  );
}
