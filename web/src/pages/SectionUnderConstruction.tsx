import { UnavailableBlock } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import type { Section } from '@/app/sections';

/**
 * Заглушкой это не является: раздел объявлен навигацией, но ещё не построен, и экран
 * честно говорит, что здесь появится. Кнопок нет — нажимать пока нечего.
 */
export function SectionUnderConstruction({ section }: { section: Section }) {
  return (
    <div className="mx-auto max-w-[1920px] px-[26px] py-10">
      <h1 className="text-heading-m font-bold text-ink-primary">{section.title}</h1>
      <Card className="mt-6">
        <UnavailableBlock title="Раздел в разработке" hint={section.purpose} />
      </Card>
    </div>
  );
}
