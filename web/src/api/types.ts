import type { components } from './schema';

type Schemas = components['schemas'];

export type Scenario = Schemas['Scenario'];
export type ScenarioValidationResult = Schemas['ScenarioValidationResult'];
export type Project = Schemas['Project'];
export type ProjectCreateRequest = Schemas['ProjectCreateRequest'];
export type ErrorDetail = Schemas['ErrorDetail'];
export type Plane = Schemas['Plane'];
export type GroundSite = Schemas['GroundSite'];
export type SiteRole = Schemas['SiteRole'];

export type ProjectDetail = Schemas['ProjectDetail'];
export type Variant = Schemas['Variant'];
export type Run = Schemas['Run'];
export type RunCreateRequest = Schemas['RunCreateRequest'];
export type RoutingPolicy = Schemas['RoutingPolicy'];
export type RunTimeline = Schemas['RunTimeline'];
export type ClientTimeline = Schemas['ClientTimeline'];
export type OutageCause = Schemas['OutageCause'];

export type ComparisonResult = Schemas['ComparisonResult'];
export type ComparisonEntry = Schemas['ComparisonEntry'];
export type ClientComparison = Schemas['ClientComparison'];
export type ClientMetrics = Schemas['ClientMetrics'];
export type ConfigMetrics = Schemas['ConfigMetrics'];
export type ParameterChange = Schemas['ParameterChange'];
export type Recommendation = Schemas['Recommendation'];

export type Experiment = Schemas['Experiment'];
export type ExperimentAxis = Schemas['ExperimentAxis'];
export type ExperimentBudget = Schemas['ExperimentBudget'];
export type ExperimentCreateRequest = Schemas['ExperimentCreateRequest'];
export type ExperimentPoint = Schemas['ExperimentPoint'];
