// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import { createReference, type BotEvent } from '@medplum/core';
import type { Claim, Location, Organization, Patient, Practitioner, PractitionerRole, Task } from '@medplum/fhirtypes';
import { KhieClient, setKhieFacilityIdentity } from '@medplum/jalihealth-khie-core';
import { MockClient } from '@medplum/mock';
import { describe, expect, test, vi } from 'vitest';
import { createAddShifOutpatientFfsBillingHandler } from './add-shif-outpatient-ffs-billing';
import { createPreviewAndSubmitShifOutpatientFfsClaimHandler } from './preview-and-submit-shif-outpatient-ffs-claim';
import { createRefreshShifOutpatientFfsPreauthHandler } from './refresh-shif-outpatient-ffs-preauth';
import { createSubmitShifOutpatientFfsPreauthHandler } from './submit-shif-outpatient-ffs-preauth';
import { KHIE_CONSENT_TOKEN_SYSTEM, KHIE_PAYER_CASE_STATUS_SYSTEM, type ShifOutpatientFfsPayerCaseInput } from './types';

const secrets: BotEvent['secrets'] = {
  KHIE_ENVIRONMENT: { name: 'KHIE_ENVIRONMENT', valueString: 'mock' },
  KHIE_CLIENT_ID: { name: 'KHIE_CLIENT_ID', valueString: 'client-123' },
  KHIE_CLIENT_SECRET: { name: 'KHIE_CLIENT_SECRET', valueString: 'secret-123' },
  KHIE_TOKEN_URL: { name: 'KHIE_TOKEN_URL', valueString: 'https://mock.khie.test/token' },
  KHIE_API_BASE_URL: { name: 'KHIE_API_BASE_URL', valueString: 'https://mock.khie.test/api/v1' },
};

describe('SHIF outpatient FFS progression', () => {
  test('requires an active same-day visit before submitting preauthorization', async () => {
    const fixture = await createFixture('same-day', 'same-day-preauth-required');
    const client = { createPreauth: vi.fn() } as unknown as KhieClient;
    const handler = createSubmitShifOutpatientFfsPreauthHandler({ createClient: () => client });

    await expect(handler(fixture.medplum, botEvent({ ...fixture.input, preauth: { diagnosis: 'J11.1' } }))).rejects.toThrow(
      'requires an active visit'
    );
    expect(client.createPreauth).not.toHaveBeenCalled();
  });

  test('submits same-day preauthorization with server-stored consent and intervention data', async () => {
    const fixture = await createFixture('same-day', 'visit-started');
    const client = { createPreauth: vi.fn().mockResolvedValue({ status: 'PENDING' }) } as unknown as KhieClient;
    const handler = createSubmitShifOutpatientFfsPreauthHandler({ createClient: () => client });

    await handler(fixture.medplum, botEvent({ ...fixture.input, preauth: { diagnosis: 'J11.1' } }));

    expect(client.createPreauth).toHaveBeenCalledWith({
      diagnosis: 'J11.1',
      consent_token: 'server-consent-token',
      intervention_code: 'SHA-18-005',
      service_type: 'OUTPATIENT',
    });
    await expectTaskStatus(fixture.medplum, fixture.task.id as string, 'preauth-submitted');
  });

  test('marks the payer case finalised only when KHIE returns FINALISED', async () => {
    const fixture = await createFixture('same-day', 'preauth-submitted');
    const client = { getPreauthStatus: vi.fn().mockResolvedValue({ preauth: { status: 'FINALISED' } }) } as unknown as KhieClient;
    const handler = createRefreshShifOutpatientFfsPreauthHandler({ createClient: () => client });

    const result = await handler(fixture.medplum, botEvent(fixture.input));

    expect(result.status).toBe('FINALISED');
    expect(client.getPreauthStatus).toHaveBeenCalledWith('server-consent-token');
    await expectTaskStatus(fixture.medplum, fixture.task.id as string, 'preauth-finalized');
  });

  test('rejects billing until the payer case is finalised', async () => {
    const fixture = await createFixture('same-day', 'preauth-pending');
    const client = { addClaimLines: vi.fn() } as unknown as KhieClient;
    const handler = createAddShifOutpatientFfsBillingHandler({ createClient: () => client });

    await expect(handler(fixture.medplum, botEvent({ ...fixture.input, billing: { lines: [{ code: 'OP-01' }] } }))).rejects.toThrow(
      'requires a finalised preauthorization'
    );
    expect(client.addClaimLines).not.toHaveBeenCalled();
  });

  test('adds billing with persisted authorization context and allows claim submission afterward', async () => {
    const fixture = await createFixture('same-day', 'preauth-finalized');
    const client = {
      addClaimLines: vi.fn().mockResolvedValue({ accepted: true }),
      previewClaim: vi.fn().mockResolvedValue({ total: 1250 }),
      submitClaim: vi.fn().mockResolvedValue({ reference: 'CLAIM-123' }),
    } as unknown as KhieClient;
    const addBilling = createAddShifOutpatientFfsBillingHandler({ createClient: () => client });
    const submitClaim = createPreviewAndSubmitShifOutpatientFfsClaimHandler({ createClient: () => client });

    await addBilling(fixture.medplum, botEvent({ ...fixture.input, billing: { lines: [{ code: 'OP-01' }] } }));

    expect(client.addClaimLines).toHaveBeenCalledWith({
      lines: [{ code: 'OP-01' }],
      consent_token: 'server-consent-token',
      intervention_code: 'SHA-18-005',
      service_type: 'OUTPATIENT',
    });
    await expectTaskStatus(fixture.medplum, fixture.task.id as string, 'billing-lines-added');

    const result = await submitClaim(fixture.medplum, botEvent({ ...fixture.input, submission: { invoice_number: 'INV-001' } }));

    expect(result).toEqual({ preview: { total: 1250 }, submission: { reference: 'CLAIM-123' } });
    expect(client.previewClaim).toHaveBeenCalledWith('server-consent-token');
    expect(client.submitClaim).toHaveBeenCalledWith({ invoice_number: 'INV-001', consent_token: 'server-consent-token' });
    await expectTaskStatus(fixture.medplum, fixture.task.id as string, 'claim-submitted', 'completed');
  });
});

async function createFixture(preauthPath: 'same-day' | 'elective', businessStatus: string) {
  const medplum = new MockClient();
  const organization = await medplum.createResource<Organization>({ resourceType: 'Organization', name: 'JaliHealth' });
  const location = await medplum.createResource<Location>(
    setKhieFacilityIdentity(
      { resourceType: 'Location', name: 'Westlands Clinic', managingOrganization: createReference(organization) },
      { code: 'FID-47-115307-8', type: 'fr-code' },
      { enabled: true, status: 'active', supportedFunds: ['SHIF'], claimAccessPoints: ['OP'] }
    )
  );
  const patient = await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'Test' }] });
  const practitioner = await medplum.createResource<Practitioner>({ resourceType: 'Practitioner', name: [{ family: 'Doctor' }] });
  const practitionerRole = await medplum.createResource<PractitionerRole>({
    resourceType: 'PractitionerRole',
    practitioner: createReference(practitioner),
    organization: createReference(organization),
    location: [createReference(location)],
  });
  const claim = await medplum.createResource<Claim>({
    resourceType: 'Claim',
    status: 'draft',
    type: { text: 'SHIF outpatient fee-for-service' },
    use: 'claim',
    patient: createReference(patient),
    created: new Date().toISOString(),
    provider: createReference(practitionerRole),
    priority: { text: 'normal' },
    identifier: [{ system: KHIE_CONSENT_TOKEN_SYSTEM, value: 'server-consent-token' }],
  });
  const task = await medplum.createResource<Task>({
    resourceType: 'Task',
    status: 'in-progress',
    intent: 'order',
    focus: createReference(claim),
    for: createReference(patient),
    businessStatus: { coding: [{ system: KHIE_PAYER_CASE_STATUS_SYSTEM, code: businessStatus }] },
    input: [
      { type: { text: 'KHIE patient ID' }, valueString: 'CR-456' },
      { type: { text: 'KHIE intervention code' }, valueString: 'SHA-18-005' },
      { type: { text: 'KHIE preauthorization path' }, valueString: preauthPath },
    ],
  });
  return {
    medplum,
    task,
    input: {
      patient: createReference(patient),
      practitionerRole: createReference(practitionerRole),
      taskId: task.id as string,
      claimId: claim.id as string,
      selectedLocation: createReference(location),
    } satisfies ShifOutpatientFfsPayerCaseInput,
  };
}

function botEvent<T extends ShifOutpatientFfsPayerCaseInput>(input: T): BotEvent<T> {
  return { bot: { reference: 'Bot/khie-shif' }, input, contentType: 'application/fhir+json', secrets };
}

async function expectTaskStatus(medplum: MockClient, taskId: string, code: string, status?: Task['status']): Promise<void> {
  await expect(medplum.readResource('Task', taskId)).resolves.toMatchObject({
    ...(status ? { status } : {}),
    businessStatus: { coding: [expect.objectContaining({ code })] },
  });
}