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

/** Экран «01 · Проекты — Новый расчёт»: загрузка сценария, обзор и вход в проект. */
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
    <div className="mx-auto max-w-[1920px] px-[26px] pb-14 pt-8">
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
      <div className="grid gap-[29px] xl:grid-cols-[1115fr_721fr]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-8 px-[18px]">
            <div>
              <h1 className="text-heading-xl font-bold text-ink-primary">Новый расчёт</h1>
              <p className="mt-3 text-title-l text-ink-secondary">
                Загрузите сценарий JSON или выберите один из примеров, чтобы начать работу.
              </p>
            </div>
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
          </div>

          <div className="mt-6">
            <DropzoneCard
              onFile={(file) => {
                startCheck({ kind: 'file', file });
              }}
              onBrowse={browse}
              onShowExamples={() => {
                examplesSection.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }}
            />
          </div>

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
        </div>

        <div className="flex min-w-0 flex-col gap-5">
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
        </div>
      </div>

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
