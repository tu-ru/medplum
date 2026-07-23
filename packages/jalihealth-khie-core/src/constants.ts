// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

export const KHIE_FACILITY_REGISTRY_SYSTEM = 'https://khie.go.ke/facility-registry';
export const KHIE_FACILITY_INTEGRATION_EXTENSION_URL =
  'https://jalihealth.ke/fhir/StructureDefinition/khie-facility-integration';
export const JALIHEALTH_DEFAULT_LOCATION_EXTENSION_URL =
  'https://jalihealth.ke/fhir/StructureDefinition/default-location';
export const JALIHEALTH_ROLE_SYSTEM = 'https://jalihealth.ke/fhir/CodeSystem/staff-role';

export const KHIE_FACILITY_INTEGRATION_FIELDS = {
  enabled: 'khieEnabled',
  environment: 'environment',
  supportedFund: 'supportedFund',
  claimAccessPoint: 'claimAccessPoint',
  status: 'status',
  tenantId: 'tenantId',
} as const;
