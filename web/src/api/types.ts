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
export type VariantCreateRequest = Schemas['VariantCreateRequest'];
export type Environment = Schemas['Environment'];
export type Satellite = Schemas['Satellite'];
export type SatelliteFailure = Schemas['SatelliteFailure'];
export type GatewayOutage = Schemas['GatewayOutage'];

export type Run = Schemas['Run'];
export type RunStatus = Schemas['RunStatus'];
export type RunStage = Schemas['RunStage'];
export type RunProgressEvent = Schemas['RunProgressEvent'];
export type RoutingPolicy = Schemas['RoutingPolicy'];

export type Snapshot = Schemas['Snapshot'];
export type SnapshotSatellite = Schemas['SnapshotSatellite'];
export type SnapshotEdge = Schemas['SnapshotEdge'];
export type ClientRoute = Schemas['ClientRoute'];
export type OutageCause = Schemas['OutageCause'];
export type OutageInterval = Schemas['OutageInterval'];
export type OutageChange = Schemas['OutageChange'];

export type RunTimeline = Schemas['RunTimeline'];
export type ClientTimeline = Schemas['ClientTimeline'];
export type RunMetrics = Schemas['RunMetrics'];
export type ClientMetrics = Schemas['ClientMetrics'];
export type ConfigMetrics = Schemas['ConfigMetrics'];
export type BackupPaths = Schemas['BackupPaths'];

export type ComparisonResult = Schemas['ComparisonResult'];
export type ComparisonEntry = Schemas['ComparisonEntry'];
export type ClientComparison = Schemas['ClientComparison'];
export type CriticalityReport = Schemas['CriticalityReport'];
export type SatelliteCriticality = Schemas['SatelliteCriticality'];
