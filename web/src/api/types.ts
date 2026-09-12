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
export type ParameterChange = Schemas['ParameterChange'];
export type LineageGraph = Schemas['LineageGraph'];
export type LineageEdge = Schemas['LineageEdge'];
export type Run = Schemas['Run'];
export type RunCreateRequest = Schemas['RunCreateRequest'];
export type RunMetrics = Schemas['RunMetrics'];
export type RunTimeline = Schemas['RunTimeline'];
export type ClientMetrics = Schemas['ClientMetrics'];
export type ClientTimeline = Schemas['ClientTimeline'];
export type OutageInterval = Schemas['OutageInterval'];
export type OutageCause = Schemas['OutageCause'];
export type RoutingPolicy = Schemas['RoutingPolicy'];
export type RunStatus = Schemas['RunStatus'];
export type Snapshot = Schemas['Snapshot'];
export type ClientRoute = Schemas['ClientRoute'];
