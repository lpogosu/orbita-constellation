import { UnavailableBlock } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import type { Section } from '@/app/sections';

/**
 * Заглушкой это не является: раздел объявлен навигацией, но ещё не построен, и экран
 * честно говорит, что здесь появится. Кнопок нет — нажимать пока нечего.
 */
export function SectionUnderConstruction({ section }: { section: Section }) {
  return (
    <div className="absolute inset-x-[26px] top-[124px]">
      <h1 className="text-heading-m font-bold text-ink-primary">{section.title}</h1>
      <Card sceneX={26} sceneY={200} className="mt-6 h-[420px]">
        <UnavailableBlock title="Раздел в разработке" hint={section.purpose} />
      </Card>
    </div>
  );
}
