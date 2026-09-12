import { FileText, FolderOpen } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { cx } from '@/lib/cx';

interface DropzoneCardProps {
  onFile: (file: File) => void;
  /** Открыть системный диалог выбора файла; сам `input` живёт на странице. */
  onBrowse: () => void;
  /** Перевести внимание на четыре карточки примеров — они видны без прокрутки. */
  onShowExamples: () => void;
}

/** Card / Dropzone: 1115×498 на (26, 245), координаты частей — из узла макета. */
export function DropzoneCard({ onFile, onBrowse, onShowExamples }: DropzoneCardProps) {
  const [dragging, setDragging] = useState(false);

  return (
    <Card
      sceneX={26}
      sceneY={245}
      className={cx(
        'absolute left-[26px] top-[245px] h-[498px] w-[1115px] transition-colors duration-150',
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

      <figure className="absolute left-[39px] top-[60px] m-0">
        <img
          src="/assets/mascot-json.png"
          alt="Спутник-маскот ОРБИТЫ держит файл сценария"
          className="h-[264px] w-[396px] object-cover"
        />
        <figcaption className="absolute left-[26px] top-[284px] w-[211px] -rotate-[4deg] font-script text-[30px] font-bold leading-[1.12] tracking-[0.4px] text-ink-secondary">
          Те же
          <br />
          возможности.
          <br />
          Больше открытий!
        </figcaption>
      </figure>

      <span
        aria-hidden="true"
        className="absolute left-[235px] top-[430px] text-[22px] leading-none text-ink-muted"
      >
        ♥
      </span>

      <h2 className="absolute left-[493px] top-[78px] text-heading-m font-bold text-ink-primary">
        Загрузите сценарий JSON
      </h2>
      <p className="absolute left-[493px] top-[128px] w-[500px] text-title-l leading-[34px] text-ink-secondary">
        {dragging
          ? 'Отпустите файл — начнётся проверка.'
          : 'Перетащите файл сюда или выберите его на компьютере.'}
      </p>

      <Button
        variant="magenta"
        size="l"
        className="absolute left-[493px] top-[222px] w-[483px]"
        icon={<FolderOpen aria-hidden="true" className="size-[24px]" />}
        onClick={onBrowse}
      >
        Выбрать JSON
      </Button>

      <div aria-hidden="true" className="absolute left-[492px] top-[324px] h-[24px] w-[485px]">
        <span className="absolute left-0 top-[11px] h-px w-[202px] bg-line-divider" />
        <span className="absolute left-[222px] top-0 text-body leading-[1.45] text-ink-muted">
          или
        </span>
        <span className="absolute left-[284px] top-[11px] h-px w-[201px] bg-line-divider" />
      </div>

      <Button
        variant="secondary"
        size="l"
        className="absolute left-[565px] top-[368px] h-[66px] w-[339px]"
        icon={<FileText aria-hidden="true" className="size-[24px]" />}
        onClick={onShowExamples}
      >
        Примеры сценариев
      </Button>
    </Card>
  );
}
