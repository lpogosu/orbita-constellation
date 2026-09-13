import { FileText, FolderOpen } from 'lucide-react';
import { useState } from 'react';

import { useStacked } from '@/app/viewport-mode';
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

/**
 * Card / Dropzone: 1115×498 на (26, 245), координаты частей — из узла макета.
 *
 * В потоке маскот и действия идут столбиком на телефоне и рядом на планшете. Кнопки
 * макета размера L (72 px, шрифт 22) в узкой колонке занимают полэкрана, поэтому там
 * они ниже и мельче — размеры компонента перебиты только в ветке потока.
 */
export function DropzoneCard({ onFile, onBrowse, onShowExamples }: DropzoneCardProps) {
  const [dragging, setDragging] = useState(false);
  const stacked = useStacked();

  return (
    <Card
      sceneX={26}
      sceneY={245}
      className={cx(
        stacked
          ? 'flex flex-col items-center gap-[24px] px-[32px] pb-[32px] pt-[28px] md:flex-row md:gap-[32px] md:px-[40px]'
          : 'absolute left-[26px] top-[245px] h-[498px] w-[1115px]',
        'transition-colors duration-150',
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

      <figure
        className={
          stacked
            ? 'm-0 flex w-full max-w-[300px] shrink-0 flex-col items-center md:w-[42%] md:max-w-[340px]'
            : 'absolute left-[39px] top-[60px] m-0'
        }
      >
        <img
          src="/assets/mascot-json.png"
          alt="Спутник-маскот ОРБИТЫ держит файл сценария"
          className={
            stacked ? 'aspect-[396/264] w-full object-cover' : 'h-[264px] w-[396px] object-cover'
          }
        />
        <figcaption
          className={cx(
            '-rotate-[4deg] font-script font-bold leading-[1.12] tracking-[0.4px] text-ink-secondary',
            stacked
              ? 'mt-[8px] self-start pl-[8px] text-[22px]'
              : 'absolute left-[26px] top-[284px] w-[211px] text-[30px]',
          )}
        >
          Те же
          <br />
          возможности.
          <br />
          Больше открытий!
          {stacked && (
            <span aria-hidden="true" className="ml-[6px] text-[16px] text-ink-muted">
              ♥
            </span>
          )}
        </figcaption>
      </figure>

      {/* На полотне сердце стояло на 235×430 и садилось на хвост «й» подписи: сдвинуто
          вверх и вправо, к восклицательному знаку, чтобы не накрывать буквы. */}
      {!stacked && (
        <span
          aria-hidden="true"
          className="absolute left-[284px] top-[402px] text-[22px] leading-none text-ink-muted"
        >
          ♥
        </span>
      )}

      <div
        className={
          stacked
            ? 'flex w-full min-w-0 flex-col items-center text-center md:items-start md:text-left'
            : 'contents'
        }
      >
        <h2
          className={
            stacked
              ? 'text-title-l font-bold text-ink-primary'
              : 'absolute left-[493px] top-[78px] text-heading-m font-bold text-ink-primary'
          }
        >
          Загрузите сценарий JSON
        </h2>
        <p
          className={
            stacked
              ? 'mt-[8px] text-base text-ink-secondary'
              : 'absolute left-[493px] top-[128px] w-[500px] text-title-l leading-[34px] text-ink-secondary'
          }
        >
          {dragging
            ? 'Отпустите файл — начнётся проверка.'
            : 'Перетащите файл сюда или выберите его на компьютере.'}
        </p>

        <Button
          variant="magenta"
          size="l"
          className={
            stacked
              ? 'mt-[20px] w-full !h-[56px] !px-[20px] !text-body'
              : 'absolute left-[493px] top-[222px] w-[483px]'
          }
          icon={<FolderOpen aria-hidden="true" className="size-[24px]" />}
          onClick={onBrowse}
        >
          Выбрать JSON
        </Button>

        <div
          aria-hidden="true"
          className={
            stacked
              ? 'my-[12px] flex w-full items-center gap-[16px]'
              : 'absolute left-[492px] top-[324px] h-[24px] w-[485px]'
          }
        >
          <span
            className={
              stacked
                ? 'h-px flex-1 bg-line-divider'
                : 'absolute left-0 top-[11px] h-px w-[202px] bg-line-divider'
            }
          />
          <span
            className={cx(
              'text-body leading-[1.45] text-ink-muted',
              !stacked && 'absolute left-[222px] top-0',
            )}
          >
            или
          </span>
          <span
            className={
              stacked
                ? 'h-px flex-1 bg-line-divider'
                : 'absolute left-[284px] top-[11px] h-px w-[201px] bg-line-divider'
            }
          />
        </div>

        <Button
          variant="secondary"
          size="l"
          className={
            stacked
              ? 'w-full !h-[52px] !px-[20px] !text-base'
              : 'absolute left-[565px] top-[368px] h-[66px] w-[339px]'
          }
          icon={<FileText aria-hidden="true" className="size-[24px]" />}
          onClick={onShowExamples}
        >
          Примеры сценариев
        </Button>
      </div>
    </Card>
  );
}
