// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { BotEvent } from '@medplum/core';
import { createReference } from '@medplum/core';
import type { Location, Organization, Patient, Practitioner, PractitionerRole } from '@medplum/fhirtypes';
import { KhieClient, setKhieFacilityIdentity } from '@medplum/jalihealth-khie-core';
import { MockClient } from '@medplum/mock';
import { describe, expect, test, vi } from 'vitest';
import { createStartShifOutpatientFfsHandler } from './start-shif-outpatient-ffs';
import { createStartUhcVisitHandler } from './start-visit';
import type { StartShifOutpatientFfsInput, StartUhcVisitInput } from './types';

const secrets: BotEvent['secrets'] = {
  KHIE_ENVIRONMENT: { name: 'KHIE_ENVIRONMENT', valueString: 'mock' },
  KHIE_CLIENT_ID: { name: 'KHIE_CLIENT_ID', valueString: 'client-123' },
  KHIE_CLIENT_SECRET: { name: 'KHIE_CLIENT_SECRET', valueString: 'secret-123' },
  KHIE_TOKEN_URL: { name: 'KHIE_TOKEN_URL', valueString: 'https://mock.khie.test/token' },
  KHIE_API_BASE_URL: { name: 'KHIE_API_BASE_URL', valueString: 'https://mock.khie.test/api/v1' },
};

describe('UHC outpatient capitation start visit', () => {
  test('creates a UHC Coverage, draft Claim, and eligibility-confirmed payer Task', async () => {
    const fixture = await createFixture();
    const client = {
      getEligibility: vi.fn().mockResolvedValue({ memberCrNumber: 'CR-123' }),
      getInterventions: vi.fn().mockResolvedValue([{ fund: 'UHC', paymentMechanism: 'CAPITATION', interventionCode: 'UHC-OP' }]),
    } as unknown as KhieClient;
    const handler = createStartUhcVisitHandler({ createClient: () => client });

    const result = await handler(fixture.medplum, botEvent(fixture.input));

    expect(client.getInterventions).toHaveBeenCalledWith('CR-123');
    expect(await fixture.medplum.readResource('Coverage', result.coverageId)).toMatchObject({
      status: 'active',
      subscriberId: 'CR-123',
    });
    expect(await fixture.medplum.readResource('Claim', result.claimId)).toMatchObject({
      status: 'draft',
      use: 'claim',
      facility: { reference: `Location/${fixture.location.id}` },
    });
    expect(await fixture.medplum.readResource('Task', result.taskId)).toMatchObject({
      status: 'ready',
      businessStatus: { coding: [expect.objectContaining({ code: 'eligibility-confirmed' })] },
    });
  });

  test('rejects a non-capitation intervention without creating payer resources', async () => {
    const fixture = await createFixture();
    const client = {
      getEligibility: vi.fn().mockResolvedValue({ memberCrNumber: 'CR-123' }),
      getInterventions: vi.fn().mockResolvedValue([{ fund: 'UHC', paymentMechanism: 'FEE_FOR_SERVICE' }]),
    } as unknown as KhieClient;
    const handler = createStartUhcVisitHandler({ createClient: () => client });

    await expect(handler(fixture.medplum, botEvent(fixture.input))).rejects.toThrow('No eligible UHC outpatient capitation intervention');
    expect(await fixture.medplum.searchResources('Claim')).toHaveLength(0);
  });

  test('rejects an unassigned facility before making a KHIE request', async () => {
    const fixture = await createFixture(false);
    const client = {
      getEligibility: vi.fn(),
      getInterventions: vi.fn(),
    } as unknown as KhieClient;
    const handler = createStartUhcVisitHandler({ createClient: () => client });

    await expect(handler(fixture.medplum, botEvent(fixture.input))).rejects.toThrow('not assigned to the resolved KHIE facility');
    expect(client.getEligibility).not.toHaveBeenCalled();
  });
});

describe('SHIF outpatient fee-for-service start', () => {
  test('routes a same-day preauthorization intervention to the normal FFS workflow', async () => {
    const fixture = await createFixture(true, 'SHIF');
    const client = {
      getEligibility: vi.fn().mockResolvedValue({ memberCrNumber: 'CR-456' }),
      getInterventions: vi.fn().mockResolvedValue([
        { fund: 'SHIF', accessPoint: 'OP', paymentMechanism: 'FEE_FOR_SERVICE', needsPreauth: true, interventionCode: 'SHA-18-005' },
      ]),
    } as unknown as KhieClient;
    const handler = createStartShifOutpatientFfsHandler({ createClient: () => client });
    const result = await handler(fixture.medplum, botEvent({ ...fixture.input, interventionCode: 'SHA-18-005' }));

    expect(result.preauthPath).toBe('same-day');
    expect(await fixture.medplum.readResource('Task', result.taskId)).toMatchObject({
      businessStatus: { coding: [expect.objectContaining({ code: 'same-day-preauth-required' })] },
    });
  });

  test('routes a manual-approval intervention to the elective FFS workflow', async () => {
    const fixture = await createFixture(true, 'SHIF');
    const client = {
      getEligibility: vi.fn().mockResolvedValue({ memberCrNumber: 'CR-456' }),
      getInterventions: vi.fn().mockResolvedValue([
        {
          fund: 'SHIF',
          accessPoint: 'OP',
          paymentMechanism: 'FEE_FOR_SERVICE',
          needsPreauth: true,
          needsManualPreauthApproval: true,
          interventionCode: 'SHA-18-006',
        },
      ]),
    } as unknown as KhieClient;
    const handler = createStartShifOutpatientFfsHandler({ createClient: () => client });
    const result = await handler(fixture.medplum, botEvent({ ...fixture.input, interventionCode: 'SHA-18-006' }));

    expect(result.preauthPath).toBe('elective');
    expect(await fixture.medplum.readResource('Encounter', result.encounter.id as string)).toMatchObject({ status: 'planned' });
  });
});

async function createFixture(assigned = true, supportedFund: 'UHC' | 'SHIF' = 'UHC') {
  const medplum = new MockClient();
  const organization = await medplum.createResource<Organization>({ resourceType: 'Organization', name: 'JaliHealth' });
  const location = await medplum.createResource<Location>(
    setKhieFacilityIdentity(
      { resourceType: 'Location', name: 'Westlands Clinic', managingOrganization: createReference(organization) },
      { code: 'FID-47-115307-8', type: 'fr-code' },
      { enabled: true, status: 'active', supportedFunds: [supportedFund], claimAccessPoints: ['OP'] }
    )
  );
  const patient = await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'Test' }] });
  const practitioner = await medplum.createResource<Practitioner>({ resourceType: 'Practitioner', name: [{ family: 'Doctor' }] });
  const practitionerRole = await medplum.createResource<PractitionerRole>({
    resourceType: 'PractitionerRole',
    practitioner: createReference(practitioner),
    organization: createReference(organization),
    location: assigned ? [createReference(location)] : [],
  });
  return {
    medplum,
    location,
    input: {
      patient: createReference(patient),
      practitionerRole: createReference(practitionerRole),
      identificationNumber: '12345678',
      identificationType: 'NATIONAL_ID',
      selectedLocation: createReference(location),
    },
  };
}

function botEvent(input: StartUhcVisitInput): BotEvent<StartUhcVisitInput>;
function botEvent(input: StartShifOutpatientFfsInput): BotEvent<StartShifOutpatientFfsInput>;
function botEvent(input: StartUhcVisitInput | StartShifOutpatientFfsInput): BotEvent<StartUhcVisitInput | StartShifOutpatientFfsInput> {
  return { bot: { reference: 'Bot/khie-uhc' }, input, contentType: 'application/fhir+json', secrets };
}