import { Pencil } from 'lucide-react';

interface ProjectTitleFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Подпись под полем, когда названия нет: сервис возьмёт `meta.title` сценария. */
  placeholder: string;
  disabled: boolean;
}

/** Field / Название проекта: 441×72 на полотне, правится до нажатия «Открыть проект». */
export function ProjectTitleField({
  value,
  onChange,
  placeholder,
  disabled,
}: ProjectTitleFieldProps) {
  return (
    <div className="absolute left-[700px] top-[124px] h-[72px] w-[441px]">
      <label
        htmlFor="project-title"
        className="block h-[13px] text-micro font-semibold uppercase leading-[13px] tracking-[0.66px] text-ink-muted"
      >
        Название проекта
      </label>
      <div className="absolute inset-x-0 top-[20px] h-[52px]">
        <input
          id="project-title"
          type="text"
          value={value}
          disabled={disabled}
          maxLength={200}
          placeholder={placeholder}
          className="h-[52px] w-full rounded-sm border border-line bg-surface-input pl-[18px] pr-[46px] text-base text-ink-primary placeholder:text-ink-muted disabled:opacity-60"
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
        <Pencil
          aria-hidden="true"
          className="pointer-events-none absolute right-[20px] top-[17px] size-[18px] text-ink-muted"
        />
      </div>
    </div>
  );
}
