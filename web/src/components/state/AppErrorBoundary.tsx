import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

import { ErrorBlock } from './States';

interface AppErrorBoundaryProps {
  readonly children: ReactNode;
}

interface AppErrorBoundaryState {
  readonly failed: boolean;
}

/**
 * Последняя линия защиты: ошибка рендера не должна превращать приложение в пустой экран.
 * Детали исключения намеренно не показываем — пользователю достаточно понятного действия,
 * а техническая диагностика остаётся в консоли браузера.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Непойманная ошибка интерфейса', error, errorInfo);
  }

  override render(): ReactNode {
    if (!this.state.failed) {
      return this.props.children;
    }

    return (
      <main className="app-frame p-6">
        <div className="card-glass h-[280px] w-[min(496px,100%)]">
          <ErrorBlock
            title="Интерфейс не удалось отобразить"
            message="Обновите страницу. Если ошибка повторится, попробуйте открыть проект заново."
            onRetry={() => { window.location.reload(); }}
            retryLabel="Обновить страницу"
            appearance="figma"
          />
        </div>
      </main>
    );
  }
}
