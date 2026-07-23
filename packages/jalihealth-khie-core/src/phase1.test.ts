// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import { getExtension } from '@medplum/core';
import type { Location } from '@medplum/fhirtypes';
import {
    createKhieFacilityIntegrationStructureDefinition,
    createPhase1Seed,
    createPractitionerRoleAssignment,
    getDefaultLocation,
    getJaliHealthRole,
    getKhieFacilityIdentity,
    getKhieFacilityIntegrationProfile,
    JALIHEALTH_ROLE_SYSTEM,
    KHIE_FACILITY_REGISTRY_SYSTEM,
    setKhieFacilityIdentity,
} from './index';

describe('KHIE Phase 1 facility and identity model', () => {
  test('stores the KHIE facility identity in a Location identifier and profile extension', () => {
    const location = setKhieFacilityIdentity(
      { resourceType: 'Location', status: 'active', name: 'Test Facility' },
      { code: 'FID-47-115307-8', type: 'fr-code' },
      {
        enabled: true,
        environment: 'sandbox',
        supportedFunds: ['SHIF', 'UHC'],
        claimAccessPoints: ['OP'],
        status: 'active',
        tenantId: 'tenant-1',
      }
    );

    expect(location.identifier).toContainEqual({
      system: KHIE_FACILITY_REGISTRY_SYSTEM,
      value: 'FID-47-115307-8',
      type: { text: 'fr-code' },
    });
    expect(getKhieFacilityIdentity(location)).toEqual({
      code: 'FID-47-115307-8',
      type: 'fr-code',
      profile: {
        enabled: true,
        environment: 'sandbox',
        supportedFunds: ['SHIF', 'UHC'],
        claimAccessPoints: ['OP'],
        status: 'active',
        tenantId: 'tenant-1',
      },
    });
  });

  test('does not treat an incomplete integration extension as an enabled KHIE facility', () => {
    const location: Location = {
      resourceType: 'Location',
      status: 'active',
      identifier: [{ system: KHIE_FACILITY_REGISTRY_SYSTEM, value: 'FID-47-115307-8', type: { text: 'fr-code' } }],
    };

    expect(getKhieFacilityIntegrationProfile(location)).toBeUndefined();
    expect(getKhieFacilityIdentity(location)).toBeUndefined();
  });

  test('records staff role, permitted locations, and a default working location on PractitionerRole', () => {
    const assignment = createPractitionerRoleAssignment({
      practitioner: { reference: 'Practitioner/doctor-123' },
      organization: { reference: 'Organization/group-1' },
      locations: [{ reference: 'Location/central-hospital-opd' }],
      defaultLocation: { reference: 'Location/central-hospital-opd' },
      role: 'doctor',
    });

    expect(assignment.code?.[0].coding).toContainEqual({ system: JALIHEALTH_ROLE_SYSTEM, code: 'doctor' });
    expect(assignment.location).toEqual([{ reference: 'Location/central-hospital-opd' }]);
    expect(getJaliHealthRole(assignment)).toBe('doctor');
    expect(getDefaultLocation(assignment)).toEqual({ reference: 'Location/central-hospital-opd' });
  });

  test('creates an internally consistent demo tenant, facility tree, assignments, and policies', () => {
    const seed = createPhase1Seed();
    const centralHospital = seed.locations.find((location) => location.id === 'central-hospital');
    const outpatientDepartment = seed.locations.find((location) => location.id === 'central-hospital-opd');

    expect(seed.organization.name).toBe('JaliHealth Demo Hospital Group');
    expect(centralHospital && getKhieFacilityIdentity(centralHospital)?.code).toBe('FID-47-115307-8');
    expect(outpatientDepartment?.partOf).toEqual({ reference: 'Location/central-hospital' });
    expect(seed.practitionerRoles).toHaveLength(7);
    expect(seed.accessPolicies).toHaveLength(7);
    expect(seed.resources).toContainEqual(
      expect.objectContaining({ url: 'https://jalihealth.ke/fhir/StructureDefinition/khie-facility-integration' })
    );
    expect(seed.accessPolicies.find((policy) => policy.name === 'JaliHealth claims-officer baseline policy')?.resource).toEqual(
      expect.arrayContaining([expect.objectContaining({ resourceType: 'Claim' })])
    );
    expect(getExtension(seed.practitionerRoles[0], 'https://jalihealth.ke/fhir/StructureDefinition/default-location'))
      .toMatchObject({ valueReference: { reference: 'Location/central-hospital-opd' } });
  });

  test('publishes a Location-scoped complex extension for facility integration configuration', () => {
    const profile = createKhieFacilityIntegrationStructureDefinition();

    expect(profile.context).toEqual([{ type: 'element', expression: 'Location' }]);
    expect(profile.type).toBe('Extension');
    expect(profile.differential?.element).toContainEqual(
      expect.objectContaining({ path: 'Extension.value[x]', max: '0' })
    );
  });
});
