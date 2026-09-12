import { Pencil } from 'lucide-react';

interface ProjectTitleFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Подпись под полем, когда названия нет: сервис возьмёт `meta.title` сценария. */
  placeholder: string;
  disabled: boolean;
}

/** Field / Название проекта: правится до нажатия «Открыть проект». */
export function ProjectTitleField({
  value,
  onChange,
  placeholder,
  disabled,
}: ProjectTitleFieldProps) {
  return (
    <div className="w-[441px] max-w-full">
      <label
        htmlFor="project-title"
        className="block text-micro font-semibold uppercase tracking-[0.66px] text-ink-muted"
      >
        Название проекта
      </label>
      <div className="relative mt-[7px]">
        <input
          id="project-title"
          type="text"
          value={value}
          disabled={disabled}
          maxLength={200}
          placeholder={placeholder}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          className="h-[52px] w-full rounded-sm border border-line bg-surface-input pl-[18px] pr-12 text-base text-ink-primary placeholder:text-ink-muted disabled:opacity-60"
        />
        <Pencil
          aria-hidden="true"
          className="pointer-events-none absolute right-[18px] top-1/2 size-[18px] -translate-y-1/2 text-ink-muted"
        />
      </div>
    </div>
  );
}
