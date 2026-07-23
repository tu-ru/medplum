// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { Location, Organization, PractitionerRole } from '@medplum/fhirtypes';
import { createRoleAccessPolicy } from './access-policy';
import { setKhieFacilityIdentity } from './facility';
import { createDefaultLocationStructureDefinition, createKhieFacilityIntegrationStructureDefinition } from './profiles';
import { createPractitionerRoleAssignment } from './roles';
import type { JaliHealthRole, Phase1Seed } from './types';

const KHIE_PROFILE = {
  enabled: true,
  environment: 'mock' as const,
  supportedFunds: ['SHIF', 'UHC', 'ECCIF'] as const,
  claimAccessPoints: ['OP', 'IP'] as const,
  status: 'active' as const,
  tenantId: 'jalihealth-demo',
};

export function createPhase1Seed(): Phase1Seed {
  const organization: Organization = {
    resourceType: 'Organization',
    id: 'jalihealth-demo-group',
    active: true,
    name: 'JaliHealth Demo Hospital Group',
  };
  const centralHospital = setKhieFacilityIdentity(
    {
      resourceType: 'Location',
      id: 'central-hospital',
      status: 'active',
      name: 'Central Hospital',
      managingOrganization: { reference: 'Organization/jalihealth-demo-group' },
      physicalType: { coding: [{ code: 'si', display: 'Site' }] },
    },
    { code: 'FID-47-115307-8', type: 'fr-code' },
    KHIE_PROFILE
  );
  const outpatientDepartment: Location = {
    resourceType: 'Location',
    id: 'central-hospital-opd',
    status: 'active',
    name: 'Central Hospital Outpatient Department',
    managingOrganization: { reference: 'Organization/jalihealth-demo-group' },
    partOf: { reference: 'Location/central-hospital' },
    physicalType: { coding: [{ code: 'wa', display: 'Ward' }] },
  };
  const westlandsClinic = setKhieFacilityIdentity(
    {
      resourceType: 'Location',
      id: 'westlands-clinic',
      status: 'active',
      name: 'Westlands Clinic',
      managingOrganization: { reference: 'Organization/jalihealth-demo-group' },
      physicalType: { coding: [{ code: 'si', display: 'Site' }] },
    },
    { code: 'FID-47-115308-6', type: 'fr-code' },
    KHIE_PROFILE
  );

  const locations = [centralHospital, outpatientDepartment, westlandsClinic];
  const roles: JaliHealthRole[] = [
    'receptionist',
    'doctor',
    'nurse',
    'pharmacist',
    'claims-officer',
    'organization-admin',
    'platform-admin',
  ];
  const practitionerRoles: PractitionerRole[] = roles.map((role) =>
    createPractitionerRoleAssignment({
      practitioner: { reference: `Practitioner/demo-${role}` },
      organization: { reference: 'Organization/jalihealth-demo-group' },
      locations: [{ reference: 'Location/central-hospital-opd' }],
      role,
      defaultLocation: { reference: 'Location/central-hospital-opd' },
    })
  );
  const accessPolicies = roles.map(createRoleAccessPolicy);
  const structureDefinitions = [
    createKhieFacilityIntegrationStructureDefinition(),
    createDefaultLocationStructureDefinition(),
  ];

  return {
    organization,
    locations,
    practitionerRoles,
    accessPolicies,
    resources: [organization, ...locations, ...practitionerRoles, ...accessPolicies, ...structureDefinitions],
  };
}
