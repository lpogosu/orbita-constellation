import { useMemo } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';

import { SelectProject } from '@/pages/SelectProject';
import { useProjectSelection } from './project-selection';
import { COMPARISON_PATH } from './sections';
import type { Section } from './sections';

/**
 * «Голый» путь раздела: `/network`, `/outages`, `/experiments`, `/comparison`. Такой адрес
 * не бывает конечным — раздел показывает конкретный проект, — поэтому он либо дополняется
 * текущим проектом, либо просит его выбрать. Запрос ссылки при этом сохраняется: адрес
 * «/comparison?runs=…» не должен потерять прогоны по дороге к своему проекту.
 */
export function SectionEntry({ section }: { section: Section }) {
  const [params] = useSearchParams();
  const { selection } = useProjectSelection();
  const { projectId } = selection;

  const target = useMemo(() => {
    if (projectId === null) {
      return null;
    }
    if (section.path === COMPARISON_PATH) {
      const query = new URLSearchParams(params);
      query.set('project', projectId);
      return `${COMPARISON_PATH}?${query.toString()}`;
    }
    const query = params.toString();
    return `${section.path}/${encodeURIComponent(projectId)}${query === '' ? '' : `?${query}`}`;
  }, [params, projectId, section.path]);

  if (target === null) {
    return <SelectProject section={section} />;
  }
  return <Navigate to={target} replace />;
}
