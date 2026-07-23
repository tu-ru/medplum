// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import { createReference, type BotEvent } from '@medplum/core';
import type { Location, Organization, Patient, Practitioner, PractitionerRole } from '@medplum/fhirtypes';
import { KhieClient, setKhieFacilityIdentity } from '@medplum/jalihealth-khie-core';
import { MockClient } from '@medplum/mock';
import { describe, expect, test, vi } from 'vitest';
import { createStartShifInpatientHandler } from './start-shif-inpatient';
import type { StartShifInpatientInput } from './types';

const secrets: BotEvent['secrets'] = {
  KHIE_ENVIRONMENT: { name: 'KHIE_ENVIRONMENT', valueString: 'mock' },
  KHIE_CLIENT_ID: { name: 'KHIE_CLIENT_ID', valueString: 'client-123' },
  KHIE_CLIENT_SECRET: { name: 'KHIE_CLIENT_SECRET', valueString: 'secret-123' },
  KHIE_TOKEN_URL: { name: 'KHIE_TOKEN_URL', valueString: 'https://mock.khie.test/token' },
  KHIE_API_BASE_URL: { name: 'KHIE_API_BASE_URL', valueString: 'https://mock.khie.test/api/v1' },
};

describe('start SHIF inpatient workflow', () => {
  test('creates an inpatient per-diem payer case without a preauthorization path', async () => {
    const fixture = await createFixture();
    const client = {
      getEligibility: vi.fn().mockResolvedValue({ memberCrNumber: 'CR-456' }),
      getInterventions: vi.fn().mockResolvedValue([{
        interventionCode: 'IP-PD-01', fund: 'SHIF', accessPoint: 'IP', paymentMechanism: 'PER_DIEM', needsPreauth: false,
      }]),
    } as unknown as KhieClient;
    const handler = createStartShifInpatientHandler({ createClient: () => client });

    const result = await handler(fixture.medplum, botEvent({ ...fixture.input, interventionCode: 'IP-PD-01', paymentMechanism: 'PER_DIEM' }));

    expect(result.paymentMechanism).toBe('PER_DIEM');
    expect(result.preauthPath).toBeUndefined();
    expect(result.encounter).toMatchObject({ class: { code: 'IMP' }, status: 'in-progress' });
    await expect(fixture.medplum.readResource('Task', result.taskId)).resolves.toMatchObject({
      businessStatus: { coding: [expect.objectContaining({ code: 'admission-consent-required' })] },
    });
  });

  test('creates an elective FFS payer case when KHIE requires manual approval', async () => {
    const fixture = await createFixture();
    const client = {
      getEligibility: vi.fn().mockResolvedValue({ memberCrNumber: 'CR-456' }),
      getInterventions: vi.fn().mockResolvedValue([{
        interventionCode: 'IP-FFS-01', fund: 'SHIF', accessPoint: 'IP', paymentMechanism: 'FEE_FOR_SERVICE', needsPreauth: true, needsManualPreauthApproval: true,
      }]),
    } as unknown as KhieClient;
    const handler = createStartShifInpatientHandler({ createClient: () => client });

    const result = await handler(fixture.medplum, botEvent({ ...fixture.input, interventionCode: 'IP-FFS-01', paymentMechanism: 'FEE_FOR_SERVICE' }));

    expect(result).toMatchObject({ paymentMechanism: 'FEE_FOR_SERVICE', preauthPath: 'elective', encounter: { status: 'planned' } });
    await expect(fixture.medplum.readResource('Task', result.taskId)).resolves.toMatchObject({
      businessStatus: { coding: [expect.objectContaining({ code: 'elective-preauth-required' })] },
    });
  });
});

async function createFixture() {
  const medplum = new MockClient();
  const organization = await medplum.createResource<Organization>({ resourceType: 'Organization', name: 'JaliHealth' });
  const location = await medplum.createResource<Location>(setKhieFacilityIdentity(
    { resourceType: 'Location', name: 'Central Hospital', managingOrganization: createReference(organization) },
    { code: 'FID-47-115307-8', type: 'fr-code' },
    { enabled: true, status: 'active', supportedFunds: ['SHIF'], claimAccessPoints: ['IP'] }
  ));
  const patient = await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'Test' }] });
  const practitioner = await medplum.createResource<Practitioner>({ resourceType: 'Practitioner', name: [{ family: 'Doctor' }] });
  const practitionerRole = await medplum.createResource<PractitionerRole>({
    resourceType: 'PractitionerRole', practitioner: createReference(practitioner), organization: createReference(organization), location: [createReference(location)],
  });
  return {
    medplum,
    input: {
      patient: createReference(patient),
      practitionerRole: createReference(practitionerRole),
      selectedLocation: createReference(location),
      identificationNumber: '12345678',
      identificationType: 'national-id',
    } satisfies Omit<StartShifInpatientInput, 'interventionCode'>,
  };
}

function botEvent(input: StartShifInpatientInput): BotEvent<StartShifInpatientInput> {
  return { bot: { reference: 'Bot/khie-shif' }, input, contentType: 'application/fhir+json', secrets };
}