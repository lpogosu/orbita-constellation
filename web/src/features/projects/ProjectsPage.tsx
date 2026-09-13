import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '@/api/client';
import { loadScenarioExamples } from '@/api/scenario-files';
import type { ScenarioExample } from '@/api/scenario-files';
import type { Project, Scenario } from '@/api/types';
import { useProjectSelection } from '@/app/project-selection';
import { NETWORK_PATH, PROJECTS_PATH } from '@/app/sections';
import { useStacked } from '@/app/viewport-mode';
import { describe, useResource } from '@/lib/use-resource';
import { DropzoneCard } from './DropzoneCard';
import { ProjectTitleField } from './ProjectTitleField';
import { RecentProjectsCard } from './RecentProjectsCard';
import { ScenarioCard } from './ScenarioCard';
import { ScenarioExampleCards } from './ScenarioExampleCards';
import { ValidationErrorsModal } from './ValidationErrorsModal';
import { sourceName } from './scenario-source';
import type { ScenarioSource } from './scenario-source';
import { useScenarioReview } from './use-scenario-review';
import { Block, PageRoot } from '@/components/layout/Slot';

/**
 * Экран «01 · Проекты — Новый расчёт». Блоки расставлены по координатам макета внутри
 * полотна 1920×1080: шапка 1920×92, заголовок и поле названия на y = 124, дропзона
 * 1115×498 на (26, 245), четыре примера 262×227 на y = 800 с шагом 281, «Недавние
 * проекты» 721×290 на (1170, 142) и карточка «Сценарий» 721×600 на (1170, 452).
 */
export function ProjectsPage() {
  const navigate = useNavigate();
  const stacked = useStacked();
  const { select } = useProjectSelection();
  const { review, check, reset } = useScenarioReview();

  const examples = useResource<ScenarioExample[]>(loadScenarioExamples);
  const projects = useResource<Project[]>(api.listProjects);

  const [title, setTitle] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [problemsHidden, setProblemsHidden] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const examplesSection = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Название проекта предзаполняется `meta.title` файла и остаётся за пользователем,
  // как только он его правит.
  useEffect(() => {
    if (review.kind === 'accepted' && !titleEdited) {
      setTitle(review.parsed.title);
    }
  }, [review, titleEdited]);

  const startCheck = useCallback(
    (source: ScenarioSource) => {
      setTitleEdited(false);
      setProblemsHidden(false);
      setCreateError(null);
      check(source);
    },
    [check],
  );

  const openProject = useCallback(() => {
    if (review.kind !== 'accepted') {
      return;
    }
    const trimmed = title.trim();
    setCreating(true);
    setCreateError(null);
    void api
      .createProject({
        // Сервис сам подставит `meta.title`, если название пустое.
        title: trimmed === '' ? null : trimmed,
        scenario: review.parsed.document as Scenario,
      })
      .then(
        (project) => {
          // Созданный проект сразу становится текущим: меню разделов обязано вести в него
          // ещё до того, как экран сети успеет загрузиться и сообщить о нём сам.
          select({ projectId: project.id, variantId: null, runId: null });
          navigate(`${NETWORK_PATH}/${project.id}`);
        },
        (error: unknown) => {
          setCreating(false);
          setCreateError(describe(error));
        },
      );
  }, [navigate, review, select, title]);

  const browse = useCallback(() => {
    fileInput.current?.click();
  }, []);

  return (
    // В потоке на планшете дропзона и примеры идут на всю ширину, а ниже рядом стоят
    // обзор выбранного сценария и недавние проекты. Порядок блоков в потоке задан
    // `order`: на полотне поле названия стоит у заголовка, а в колонке оно нужно рядом
    // с обзором сценария — до выбора файла оно всё равно выключено.
    <PageRoot canvasClassName="absolute inset-0" className="md:grid md:grid-cols-2 md:items-start">
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) {
            startCheck({ kind: 'file', file });
          }
          // Сброс значения: повторный выбор того же файла обязан снова дать событие.
          event.target.value = '';
        }}
      />

      <Block className="order-1 md:col-span-2">
        <h1
          className={
            stacked
              ? 'text-heading-m font-bold text-ink-primary'
              : 'absolute left-[44px] top-[124px] text-heading-xl font-bold text-ink-primary'
          }
        >
          Новый расчёт
        </h1>
        <p
          className={
            stacked
              ? 'mt-1 text-base text-ink-secondary'
              : 'absolute left-[44px] top-[203px] w-[968px] text-title-l leading-[34px] text-ink-secondary'
          }
        >
          Загрузите сценарий JSON или выберите один из примеров, чтобы начать работу.
        </p>
      </Block>

      <Block className="order-4">
        <ProjectTitleField
          value={title}
          disabled={review.kind !== 'accepted'}
          placeholder={
            review.kind === 'accepted'
              ? 'Название из meta.title файла'
              : 'Сначала выберите сценарий'
          }
          onChange={(value) => {
            setTitleEdited(true);
            setTitle(value);
          }}
        />
      </Block>

      <Block className="order-2 md:col-span-2">
        <DropzoneCard
          onFile={(file) => {
            startCheck({ kind: 'file', file });
          }}
          onBrowse={browse}
          onShowExamples={() => {
            // Кнопка переводит фокус на первый пример, чтобы выбор шёл и с клавиатуры.
            // На полотне примеры видны сразу, в потоке к ним прокручивает сам фокус.
            examplesSection.current?.querySelector('button')?.focus();
          }}
        />
      </Block>

      <Block className="order-3 md:col-span-2">
        <ScenarioExampleCards
          ref={examplesSection}
          examples={examples.data}
          error={examples.error}
          onRetry={examples.reload}
          selectedName={review.kind === 'idle' ? null : sourceName(review.source)}
          onPick={(example) => {
            startCheck({ kind: 'example', example });
          }}
        />
      </Block>

      <Block className="order-6 md:order-5 md:row-span-2">
        <RecentProjectsCard
          projects={projects.data}
          error={projects.error}
          onRetry={projects.reload}
          onOpen={(project) => {
            // Строка списка ведёт на экран проекта: там варианты, прогоны и происхождение.
            // На «Сеть» ведёт кнопка «Открыть проект» — она открывает только что созданный.
            select({ projectId: project.id, variantId: null, runId: null });
            navigate(`${PROJECTS_PATH}/${project.id}`);
          }}
        />
      </Block>

      <Block className="order-5 md:order-6">
        <ScenarioCard
          review={review}
          creating={creating}
          createError={createError}
          onOpenProject={openProject}
          onRecheck={() => {
            if (review.kind !== 'idle') {
              startCheck(review.source);
            }
          }}
          onShowProblems={() => {
            setProblemsHidden(false);
          }}
        />
      </Block>

      {review.kind === 'rejected' && !problemsHidden && (
        <ValidationErrorsModal
          fileName={sourceName(review.source)}
          problems={review.problems}
          sourceText={review.sourceText}
          onClose={() => {
            setProblemsHidden(true);
          }}
          onPickAnotherFile={() => {
            reset();
            browse();
          }}
          onValidateText={(text) => {
            startCheck({ kind: 'inline', name: sourceName(review.source), text });
          }}
        />
      )}
    </PageRoot>
  );
}
