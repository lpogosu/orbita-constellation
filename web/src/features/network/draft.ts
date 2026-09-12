import type {
  Environment,
  GatewayOutage,
  Plane,
  SatelliteFailure,
  Scenario,
} from '@/api/types';

/** Одно отличие черновика от сохранённого варианта: путь и обе стороны. */
export interface DraftChange {
  readonly path: string;
  readonly from: string;
  readonly to: string;
}

export function withPlane(scenario: Scenario, planeId: string, patch: Partial<Plane>): Scenario {
  return {
    ...scenario,
    design: {
      ...scenario.design,
      planes: scenario.design.planes.map((plane) =>
        plane.id === planeId ? { ...plane, ...patch } : plane,
      ),
    },
  };
}

export function withLaunchStage(scenario: Scenario, launchStage: number): Scenario {
  return { ...scenario, design: { ...scenario.design, launch_stage: launchStage } };
}

export function withEnvironment(scenario: Scenario, patch: Partial<Environment>): Scenario {
  return { ...scenario, environment: { ...scenario.environment, ...patch } };
}

export function withFailures(scenario: Scenario, failures: readonly SatelliteFailure[]): Scenario {
  return { ...scenario, failures: [...failures] };
}

export function withGatewayOutages(
  scenario: Scenario,
  outages: readonly GatewayOutage[],
): Scenario {
  return { ...scenario, gateway_outages: [...outages] };
}

/** Аппараты, активные на выбранном этапе: `launch_batch <= launch_stage`. */
export function activeSatelliteIds(scenario: Scenario): string[] {
  return scenario.design.satellites
    .filter((satellite) => satellite.launch_batch <= scenario.design.launch_stage)
    .map((satellite) => satellite.id);
}

export function clientSites(scenario: Scenario) {
  return scenario.ground_sites.filter((site) => site.role === 'client');
}

export function gatewaySites(scenario: Scenario) {
  return scenario.ground_sites.filter((site) => site.role === 'gateway');
}

const ENVIRONMENT_LABELS: Record<string, string> = {
  altitude_km: 'высота',
  inclination_deg: 'наклонение',
  earth_angle0_deg: 'угол Земли',
  horizon_s: 'горизонт',
  step_s: 'шаг',
  min_elevation_deg: 'мин. возвышение',
  isl_range_km: 'дальность ISL',
  target_availability: 'цель доступности',
};

/**
 * Отличия черновика от сохранённого варианта. Сравниваются ровно те поля, которые экран
 * даёт править: считать общий diff двух документов в браузере незачем — при сохранении
 * это сделает сервис (`Variant.diff_from_parent`).
 */
export function draftChanges(saved: Scenario, draft: Scenario): DraftChange[] {
  const changes: DraftChange[] = [];

  if (saved.design.launch_stage !== draft.design.launch_stage) {
    changes.push({
      path: 'design.launch_stage',
      from: String(saved.design.launch_stage),
      to: String(draft.design.launch_stage),
    });
  }

  draft.design.planes.forEach((plane, index) => {
    const before = saved.design.planes[index];
    if (before === undefined) {
      return;
    }
    if (before.raan_deg !== plane.raan_deg) {
      changes.push({
        path: `${plane.id} RAAN`,
        from: `${before.raan_deg}°`,
        to: `${plane.raan_deg}°`,
      });
    }
    if (before.phase_deg !== plane.phase_deg) {
      changes.push({
        path: `${plane.id} фаза`,
        from: `${before.phase_deg}°`,
        to: `${plane.phase_deg}°`,
      });
    }
  });

  for (const key of Object.keys(ENVIRONMENT_LABELS)) {
    const field = key as keyof Environment;
    if (saved.environment[field] !== draft.environment[field]) {
      changes.push({
        path: ENVIRONMENT_LABELS[key] ?? key,
        from: String(saved.environment[field]),
        to: String(draft.environment[field]),
      });
    }
  }

  if (saved.failures.length !== draft.failures.length) {
    changes.push({
      path: 'отказы',
      from: String(saved.failures.length),
      to: String(draft.failures.length),
    });
  }
  if (saved.gateway_outages.length !== draft.gateway_outages.length) {
    changes.push({
      path: 'недоступности шлюза',
      from: String(saved.gateway_outages.length),
      to: String(draft.gateway_outages.length),
    });
  }

  return changes;
}

/** Название варианта по умолчанию собирается из первого отличия, как в `14_SCREENS.md` §2.1. */
export function suggestedVariantTitle(changes: readonly DraftChange[]): string {
  const first = changes[0];
  if (first === undefined) {
    return 'Копия варианта';
  }
  const rest = changes.length - 1;
  const head = `${first.path} ${first.from} → ${first.to}`;
  return rest > 0 ? `${head} и ещё ${rest}` : head;
}
