import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '@/api/client';
import { loadScenarioExamples } from '@/api/scenario-files';
import type { ScenarioExample } from '@/api/scenario-files';
import type { Project, Scenario } from '@/api/types';
import { NETWORK_PATH } from '@/app/sections';
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

/**
 * Экран «01 · Проекты — Новый расчёт». Блоки расставлены по координатам макета внутри
 * полотна 1920×1080: шапка 1920×92, заголовок и поле названия на y = 124, дропзона
 * 1115×498 на (26, 245), четыре примера 262×227 на y = 800 с шагом 281, «Недавние
 * проекты» 721×290 на (1170, 142) и карточка «Сценарий» 721×600 на (1170, 452).
 */
export function ProjectsPage() {
  const navigate = useNavigate();
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
          navigate(`${NETWORK_PATH}/${project.id}`);
        },
        (error: unknown) => {
          setCreating(false);
          setCreateError(describe(error));
        },
      );
  }, [navigate, review, title]);

  const browse = useCallback(() => {
    fileInput.current?.click();
  }, []);

  return (
    <div className="absolute inset-0">
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

      <h1 className="absolute left-[44px] top-[124px] text-heading-xl font-bold text-ink-primary">
        Новый расчёт
      </h1>
      <p className="absolute left-[44px] top-[203px] w-[968px] text-title-l leading-[34px] text-ink-secondary">
        Загрузите сценарий JSON или выберите один из примеров, чтобы начать работу.
      </p>

      <ProjectTitleField
        value={title}
        disabled={review.kind !== 'accepted'}
        placeholder={
          review.kind === 'accepted' ? 'Название из meta.title файла' : 'Сначала выберите сценарий'
        }
        onChange={(value) => {
          setTitleEdited(true);
          setTitle(value);
        }}
      />

      <DropzoneCard
        onFile={(file) => {
          startCheck({ kind: 'file', file });
        }}
        onBrowse={browse}
        onShowExamples={() => {
          // Примеры видны на том же экране, прокручивать нечего: кнопка переводит
          // на них фокус, чтобы выбор шёл и с клавиатуры.
          examplesSection.current?.querySelector('button')?.focus();
        }}
      />

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

      <RecentProjectsCard
        projects={projects.data}
        error={projects.error}
        onRetry={projects.reload}
        onOpen={(project) => {
          navigate(`${NETWORK_PATH}/${project.id}`);
        }}
      />

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

      {review.kind === 'rejected' && !problemsHidden && (
        <ValidationErrorsModal
          fileName={sourceName(review.source)}
          problems={review.problems}
          onClose={() => {
            setProblemsHidden(true);
          }}
          onPickAnotherFile={() => {
            reset();
            browse();
          }}
          onRecheck={() => {
            startCheck(review.source);
          }}
        />
      )}
    </div>
  );
}
