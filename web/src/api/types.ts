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
