// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type {
  AccessPolicy,
  Encounter,
  Location,
  Organization,
  Practitioner,
  PractitionerRole,
  Reference,
  Resource,
} from '@medplum/fhirtypes';

export type KhieEnvironment = 'mock' | 'sandbox' | 'production';
export type KhieFacilityStatus = 'active' | 'inactive' | 'pending-onboarding';
export type KhieFund = 'SHIF' | 'UHC' | 'ECCIF';
export type KhieClaimAccessPoint = 'OP' | 'IP';
export type KhieFacilityIdType = 'fr-code' | 'registration-number';

export type KhieFacilityIntegrationProfile = {
  enabled: boolean;
  environment?: KhieEnvironment;
  supportedFunds: KhieFund[];
  claimAccessPoints: KhieClaimAccessPoint[];
  status: KhieFacilityStatus;
  tenantId?: string;
};

export type KhieFacilityIdentity = {
  code: string;
  type: KhieFacilityIdType;
  profile: KhieFacilityIntegrationProfile;
};

export type ResolvedKhieFacility = {
  facility: Location;
  code: string;
  idType: KhieFacilityIdType;
  profile: KhieFacilityIntegrationProfile;
  source: 'encounter' | 'patient-location' | 'selected-location' | 'default-location' | 'organization-default';
};

export type FacilityResolver = (reference: Reference<Location>) => Location | undefined;

export type FacilityContextInput = {
  encounter?: Encounter;
  patientLocation?: Reference<Location>;
  selectedLocation?: Reference<Location>;
  practitionerRole: PractitionerRole;
  organizationLocations?: Location[];
  resolveLocation: FacilityResolver;
};

export type KhieAuthMode = 'facility-scoped-jwt' | 'multitenant-headers';

export type KhieConfig = {
  environment: KhieEnvironment;
  authMode: KhieAuthMode;
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  apiBaseUrl: string;
  facility?: Pick<ResolvedKhieFacility, 'code' | 'idType'>;
};

export type KhieTokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

export type KhieApiCall = {
  method: 'GET' | 'POST';
  path: string;
  status: number;
  correlationId?: string;
};

export type KhieFetchResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
};

export type KhieFetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<KhieFetchResponse>;

export type KhieClientOptions = {
  fetch?: KhieFetch;
  onApiCall?: (call: KhieApiCall) => void | Promise<void>;
};

export type JaliHealthRole =
  | 'receptionist'
  | 'doctor'
  | 'nurse'
  | 'pharmacist'
  | 'claims-officer'
  | 'organization-admin'
  | 'platform-admin';

export type PractitionerRoleAssignmentInput = {
  practitioner: Reference<Practitioner>;
  organization: Reference<Organization>;
  locations: Reference<Location>[];
  role: JaliHealthRole;
  defaultLocation?: Reference<Location>;
};

export type Phase1Seed = {
  organization: Organization;
  locations: Location[];
  practitionerRoles: PractitionerRole[];
  accessPolicies: AccessPolicy[];
  resources: Resource[];
};
