// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { BotEvent } from '@medplum/core';
import { createReference } from '@medplum/core';
import type { Encounter, Location } from '@medplum/fhirtypes';
import { vi } from 'vitest';
import {
    assertUserAssignedToFacility,
    createPhase1Seed,
    createPractitionerRoleAssignment,
    getKhieConfig,
    KhieAuthorizationError,
    KhieClient,
    KhieConfigurationError,
    resolveFacilityContext,
} from './index';

const secrets: BotEvent['secrets'] = {
  KHIE_ENVIRONMENT: { name: 'KHIE_ENVIRONMENT', valueString: 'mock' },
  KHIE_CLIENT_ID: { name: 'KHIE_CLIENT_ID', valueString: 'client-123' },
  KHIE_CLIENT_SECRET: { name: 'KHIE_CLIENT_SECRET', valueString: 'secret-123' },
  KHIE_TOKEN_URL: { name: 'KHIE_TOKEN_URL', valueString: 'https://mock.khie.test/tenants/token' },
  KHIE_API_BASE_URL: { name: 'KHIE_API_BASE_URL', valueString: 'https://mock.khie.test/api/v1/' },
};

describe('KHIE Phase 2 configuration, resolution, and client', () => {
  const seed = createPhase1Seed();
  const locations = new Map(seed.locations.map((location) => [`Location/${location.id}`, location]));
  const resolveLocation = (reference: { reference?: string }): Location | undefined =>
    reference.reference ? locations.get(reference.reference) : undefined;

  test('resolves an encounter department to its registered KHIE parent facility before lower-priority sources', () => {
    const encounter: Encounter = {
      resourceType: 'Encounter',
      status: 'in-progress',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
      location: [{ location: { reference: 'Location/central-hospital-opd' }, status: 'active' }],
    };
    const resolved = resolveFacilityContext({
      encounter,
      selectedLocation: { reference: 'Location/westlands-clinic' },
      practitionerRole: seed.practitionerRoles[0],
      organizationLocations: seed.locations,
      resolveLocation,
    });

    expect(resolved.source).toBe('encounter');
    expect(resolved.facility.id).toBe('central-hospital');
    expect(resolved.code).toBe('FID-47-115307-8');
  });

  test('rejects a resolved facility that is not assigned to the acting staff role', () => {
    const role = createPractitionerRoleAssignment({
      practitioner: { reference: 'Practitioner/doctor-westlands' },
      organization: createReference(seed.organization),
      locations: [{ reference: 'Location/westlands-clinic' }],
      role: 'doctor',
    });
    const resolved = resolveFacilityContext({
      selectedLocation: { reference: 'Location/central-hospital-opd' },
      practitionerRole: seed.practitionerRoles[0],
      organizationLocations: seed.locations,
      resolveLocation,
    });

    expect(() => assertUserAssignedToFacility(role, resolved, resolveLocation)).toThrow(KhieAuthorizationError);
  });

  test('requires a server-resolved facility for the multitenant service account model', () => {
    expect(() => getKhieConfig({ secrets })).toThrow(KhieConfigurationError);
  });

  test('omits facility headers only for a dedicated facility-scoped credential', () => {
    const resolved = resolveFacilityContext({
      selectedLocation: { reference: 'Location/central-hospital-opd' },
      practitionerRole: seed.practitionerRoles[0],
      organizationLocations: seed.locations,
      resolveLocation,
    });
    const config = getKhieConfig(
      { secrets: { ...secrets, KHIE_AUTH_MODE: { name: 'KHIE_AUTH_MODE', valueString: 'facility-scoped-jwt' } } },
      resolved
    );

    expect(config.authMode).toBe('facility-scoped-jwt');
    expect(config.facility).toEqual({ code: 'FID-47-115307-8', idType: 'fr-code' });
  });

  test('sends a cached service token and server-derived facility headers on KHIE calls', async () => {
    const resolved = resolveFacilityContext({
      selectedLocation: { reference: 'Location/central-hospital-opd' },
      practitionerRole: seed.practitionerRoles[0],
      organizationLocations: seed.locations,
      resolveLocation,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'server-token', expires_in: 3600, token_type: 'Bearer' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ memberCrNumber: 'CR-123' }), { headers: { 'x-correlation-id': 'trace-1' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ memberCrNumber: 'CR-123' })));
    const calls: unknown[] = [];
    const client = new KhieClient(getKhieConfig({ secrets }, resolved), {
      fetch: fetchMock,
      onApiCall: (call) => calls.push(call),
    });

    await client.getEligibility('12345678', 'NATIONAL_ID');
    await client.getEligibility('12345678', 'NATIONAL_ID');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const request = fetchMock.mock.calls[1];
    expect(String(request[0])).toContain('/patients/eligibility?identification_number=12345678&identification_type=NATIONAL_ID');
    expect(request[1]?.headers).toMatchObject({
      Authorization: 'Bearer server-token',
      'X-Facility-Id': 'FID-47-115307-8',
      'X-Facility-Id-Type': 'fr-code',
    });
    expect(calls).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: '/tenants/token', status: 200 })])
    );
  });
});
