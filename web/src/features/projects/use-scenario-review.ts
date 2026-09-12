import { useCallback, useRef, useState } from 'react';

import { ApiError, api } from '@/api/client';
import type { ErrorDetail, ScenarioValidationResult } from '@/api/types';
import { ScenarioParseError, readSource } from './scenario-source';
import type { ParsedScenario, ScenarioSource } from './scenario-source';

/** Одна причина отказа: код и путь до поля приходят от сервиса, `05_API.md` §3. */
export interface ScenarioProblem {
  readonly code: string | null;
  readonly path: string | null;
  readonly message: string;
  /** Фактическое значение поля из `details.value`, если сервис его приложил. */
  readonly value: unknown;
}

export type ScenarioReview =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking'; readonly source: ScenarioSource }
  | {
      readonly kind: 'accepted';
      readonly source: ScenarioSource;
      readonly parsed: ParsedScenario;
      readonly summary: ScenarioValidationResult;
    }
  | {
      readonly kind: 'rejected';
      readonly source: ScenarioSource;
      readonly problems: readonly ScenarioProblem[];
      readonly sourceText: string | null;
    }
  | {
      readonly kind: 'unavailable';
      readonly source: ScenarioSource;
      readonly message: string;
    };

export interface ScenarioReviewControls {
  readonly review: ScenarioReview;
  /** Проверить источник заново: для файла с диска это повторное чтение. */
  readonly check: (source: ScenarioSource) => void;
  readonly reset: () => void;
}

export function useScenarioReview(): ScenarioReviewControls {
  const [review, setReview] = useState<ScenarioReview>({ kind: 'idle' });
  // Пользователь может успеть выбрать второй файл, пока проверяется первый: ответ на
  // устаревший запрос не должен переписывать экран.
  const attempt = useRef(0);

  const check = useCallback((source: ScenarioSource) => {
    const current = ++attempt.current;
    setReview({ kind: 'checking', source });

    void (async () => {
      let sourceText: string | null = null;
      try {
        const parsed = await readSource(source);
        sourceText = parsed.text;
        const summary = await api.validateScenario(parsed.document);
        if (attempt.current === current) {
          setReview({ kind: 'accepted', source, parsed, summary });
        }
      } catch (error) {
        if (attempt.current !== current) {
          return;
        }
        setReview(toFailure(source, error, sourceText));
      }
    })();
  }, []);

  const reset = useCallback(() => {
    attempt.current += 1;
    setReview({ kind: 'idle' });
  }, []);

  return { review, check, reset };
}

function toFailure(source: ScenarioSource, error: unknown, sourceText: string | null): ScenarioReview {
  if (error instanceof ScenarioParseError) {
    return {
      kind: 'rejected',
      source,
      problems: [{ code: null, path: null, message: error.message, value: undefined }],
      sourceText: error.sourceText ?? sourceText,
    };
  }
  // 400 — это разбор файла: все ошибки списком. Остальные коды говорят о сервисе.
  if (error instanceof ApiError && error.status === 400 && error.details.length > 0) {
    return { kind: 'rejected', source, problems: error.details.map(toProblem), sourceText };
  }
  return {
    kind: 'unavailable',
    source,
    message: error instanceof Error ? error.message : 'Неизвестная ошибка проверки',
  };
}

function toProblem(detail: ErrorDetail): ScenarioProblem {
  return {
    code: detail.code,
    path: detail.path ?? null,
    message: detail.message,
    value: detail.details?.['value'],
  };
}
