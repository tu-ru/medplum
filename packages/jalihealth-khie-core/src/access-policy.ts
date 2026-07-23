// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { AccessPolicy, AccessPolicyResource, ResourceType } from '@medplum/fhirtypes';
import type { JaliHealthRole } from './types';

const READ_WRITE_INTERACTIONS: AccessPolicyResource['interaction'] = [
  'create',
  'search',
  'read',
  'update',
  'patch',
  'delete',
  'vread',
  'history',
];

const ROLE_RESOURCE_TYPES: Record<JaliHealthRole, ResourceType[] | ['*']> = {
  receptionist: ['Patient', 'Encounter', 'Appointment', 'Task'],
  doctor: ['Patient', 'Encounter', 'Condition', 'Observation', 'ServiceRequest', 'MedicationRequest', 'Task'],
  nurse: ['Patient', 'Encounter', 'Observation', 'Task', 'MedicationAdministration'],
  pharmacist: ['Patient', 'Encounter', 'MedicationRequest', 'MedicationDispense', 'Task'],
  'claims-officer': ['Patient', 'Encounter', 'Coverage', 'Claim', 'DocumentReference', 'Task', 'Communication'],
  'organization-admin': ['Organization', 'Location', 'PractitionerRole'],
  'platform-admin': ['*'],
};

/**
 * Creates a baseline role policy. Resource-specific facility checks belong in the
 * KHIE server-side guard because FHIR resource types do not share one Location field.
 */
export function createRoleAccessPolicy(role: JaliHealthRole): AccessPolicy {
  const resourceTypes = ROLE_RESOURCE_TYPES[role];

  return {
    resourceType: 'AccessPolicy',
    name: `JaliHealth ${role} baseline policy`,
    resource: resourceTypes.map((resourceType) => ({ resourceType, interaction: READ_WRITE_INTERACTIONS })),
  };
}
