// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import { createReference, type BotEvent } from '@medplum/core';
import type { Claim, Location, Organization, Patient, Practitioner, PractitionerRole, Task } from '@medplum/fhirtypes';
import { KhieClient, setKhieFacilityIdentity } from '@medplum/jalihealth-khie-core';
import { MockClient } from '@medplum/mock';
import { describe, expect, test, vi } from 'vitest';
import { createAddEccifEmergencyProtocolHandler } from './add-eccif-emergency-protocol';
import { createCreateEccifEmergencyClaimHandler } from './create-eccif-emergency-claim';
import { createGetEccifEmergencyProtocolHandler } from './get-eccif-emergency-protocol';
import { createIdentifyEccifEmergencyPatientHandler } from './identify-eccif-emergency-patient';
import { createPreviewAndSubmitEccifClaimHandler } from './preview-and-submit-eccif-claim';
import { createResendEccifDoctorConsentHandler } from './resend-eccif-doctor-consent';
import { KHIE_CONSENT_TOKEN_SYSTEM, KHIE_PAYER_CASE_STATUS_SYSTEM, type CreateEccifEmergencyClaimInput, type EccifEmergencyPayerCaseInput } from './types';

const secrets: BotEvent['secrets'] = {
  KHIE_ENVIRONMENT: { name: 'KHIE_ENVIRONMENT', valueString: 'mock' },
  KHIE_CLIENT_ID: { name: 'KHIE_CLIENT_ID', valueString: 'client-123' },
  KHIE_CLIENT_SECRET: { name: 'KHIE_CLIENT_SECRET', valueString: 'secret-123' },
  KHIE_TOKEN_URL: { name: 'KHIE_TOKEN_URL', valueString: 'https://mock.khie.test/token' },
  KHIE_API_BASE_URL: { name: 'KHIE_API_BASE_URL', valueString: 'https://mock.khie.test/api/v1' },
};

describe('ECCIF emergency claims', () => {
  test('creates an identified emergency claim and persists its authorization code', async () => {
    const fixture = await createFixture();
    const client = { createEmergencyClaim: vi.fn().mockResolvedValue({ authorization_code: 'eccif-token' }) } as unknown as KhieClient;
    const handler = createCreateEccifEmergencyClaimHandler({ createClient: () => client });

    const result = await handler(fixture.medplum, botEvent({
      ...createEmergencyInput(fixture), patient: createReference(fixture.patient), beneficiaryCrId: 'CR-456', otp: '123456',
    }));

    expect(client.createEmergencyClaim).toHaveBeenCalledWith(expect.objectContaining({
      interventions: ['ECCIF-01'], beneficiary_cr_id: 'CR-456', otp: '123456', reference_number: 'ER-001',
    }));
    await expect(fixture.medplum.readResource('Claim', result.claimId)).resolves.toMatchObject({
      patient: createReference(fixture.patient), identifier: [expect.objectContaining({ system: KHIE_CONSENT_TOKEN_SYSTEM, value: 'eccif-token' })],
    });
    await expectTaskStatus(fixture.medplum, result.taskId, 'doctor-consent-pending');
  });

  test('creates an unidentified placeholder patient and later links the emergency claim to the identified patient', async () => {
    const fixture = await createFixture();
    const createClient = { createEmergencyClaim: vi.fn().mockResolvedValue({ authorization_code: 'eccif-token' }) } as unknown as KhieClient;
    const created = await createCreateEccifEmergencyClaimHandler({ createClient: () => createClient })(
      fixture.medplum,
      botEvent(createEmergencyInput(fixture))
    );
    expect(created.unidentified).toBe(true);
    expect(created.patient.name?.[0]?.text).toBe('Unidentified emergency patient');
    expect(createClient.createEmergencyClaim).toHaveBeenCalledWith(expect.not.objectContaining({ beneficiary_cr_id: expect.anything(), otp: expect.anything() }));

    const identifyClient = { createEmergencyClaim: vi.fn().mockResolvedValue({ accepted: true }) } as unknown as KhieClient;
    await createIdentifyEccifEmergencyPatientHandler({ createClient: () => identifyClient })(fixture.medplum, botEvent({
      patient: createReference(fixture.patient), practitionerRole: createReference(fixture.practitionerRole), selectedLocation: createReference(fixture.location),
      taskId: created.taskId, claimId: created.claimId, beneficiaryCrId: 'CR-456', otp: '654321',
    }));

    expect(identifyClient.createEmergencyClaim).toHaveBeenCalledWith({ consent_token: 'eccif-token', beneficiary_cr_id: 'CR-456', otp: '654321' });
    await expect(fixture.medplum.readResource('Claim', created.claimId)).resolves.toMatchObject({ patient: createReference(fixture.patient) });
    await expectTaskStatus(fixture.medplum, created.taskId, 'patient-identified');
  });

  test('uses persisted ECCIF context for doctor consent and emergency protocols', async () => {
    const fixture = await createEmergencyCaseFixture('identified');
    const client = {
      sendDoctorConsent: vi.fn().mockResolvedValue({ sent: true }),
      getEmergencyProtocols: vi.fn().mockResolvedValue([{ protocol_code: 'P-01' }]),
      addEmergencyProtocol: vi.fn().mockResolvedValue({ added: true }),
    } as unknown as KhieClient;

    await createResendEccifDoctorConsentHandler({ createClient: () => client })(fixture.medplum, botEvent({ ...fixture.input, doctorIdentificationNumber: 'DOC-123' }));
    expect(client.sendDoctorConsent).toHaveBeenCalledWith({
      consent_token: 'eccif-token', intervention_code: 'ECCIF-01', identification_number: 'DOC-123', request_type: 'EMERGENCY_CLAIM_DOCTOR_APPROVAL_REQUEST',
    });

    await expect(createGetEccifEmergencyProtocolHandler({ createClient: () => client })(fixture.medplum, botEvent({ ...fixture.input, active: true })))
      .resolves.toEqual([{ protocol_code: 'P-01' }]);
    expect(client.getEmergencyProtocols).toHaveBeenCalledWith('ECCIF-01', true);

    await createAddEccifEmergencyProtocolHandler({ createClient: () => client })(fixture.medplum, botEvent({ ...fixture.input, protocol: { protocol_code: 'P-01' } }));
    expect(client.addEmergencyProtocol).toHaveBeenCalledWith({ protocol_code: 'P-01', consent_token: 'eccif-token' });
    await expectTaskStatus(fixture.medplum, fixture.task.id as string, 'protocols-added');
  });

  test('requires a reason before submitting an unidentified emergency claim', async () => {
    const fixture = await createEmergencyCaseFixture('unidentified');
    const client = { previewClaim: vi.fn(), submitClaim: vi.fn() } as unknown as KhieClient;
    const handler = createPreviewAndSubmitEccifClaimHandler({ createClient: () => client });

    await expect(handler(fixture.medplum, botEvent({ ...fixture.input, dischargeReason: 'RECOVERED', invoiceNumber: 'INV-001' })))
      .rejects.toThrow('requires a reason for the unknown patient');
    expect(client.previewClaim).not.toHaveBeenCalled();
  });

  test('previews and submits a completed identified emergency claim', async () => {
    const fixture = await createEmergencyCaseFixture('identified');
    const client = {
      previewClaim: vi.fn().mockResolvedValue({ total: 1250 }),
      submitClaim: vi.fn().mockResolvedValue({ reference: 'ECCIF-123' }),
    } as unknown as KhieClient;

    const result = await createPreviewAndSubmitEccifClaimHandler({ createClient: () => client })(fixture.medplum, botEvent({
      ...fixture.input, dischargeReason: 'RECOVERED', invoiceNumber: 'INV-001',
    }));

    expect(result).toEqual({ preview: { total: 1250 }, submission: { reference: 'ECCIF-123' } });
    expect(client.submitClaim).toHaveBeenCalledWith({ consent_token: 'eccif-token', discharge_reason: 'RECOVERED', invoice_number: 'INV-001' });
    await expect(fixture.medplum.readResource('Claim', fixture.claim.id as string)).resolves.toMatchObject({ status: 'active' });
    await expectTaskStatus(fixture.medplum, fixture.task.id as string, 'claim-submitted', 'completed');
  });
});

async function createFixture() {
  const medplum = new MockClient();
  const organization = await medplum.createResource<Organization>({ resourceType: 'Organization', name: 'JaliHealth' });
  const location = await medplum.createResource<Location>(setKhieFacilityIdentity(
    { resourceType: 'Location', name: 'Emergency Department', managingOrganization: createReference(organization) },
    { code: 'FID-47-115307-8', type: 'fr-code' },
    { enabled: true, status: 'active', supportedFunds: ['ECCIF'], claimAccessPoints: ['OP'] }
  ));
  const patient = await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'Test' }] });
  const practitioner = await medplum.createResource<Practitioner>({ resourceType: 'Practitioner', name: [{ family: 'Doctor' }] });
  const practitionerRole = await medplum.createResource<PractitionerRole>({
    resourceType: 'PractitionerRole', practitioner: createReference(practitioner), organization: createReference(organization), location: [createReference(location)],
  });
  return { medplum, location, patient, practitionerRole };
}

function createEmergencyInput(fixture: Awaited<ReturnType<typeof createFixture>>): CreateEccifEmergencyClaimInput {
  return {
    practitionerRole: createReference(fixture.practitionerRole), selectedLocation: createReference(fixture.location), interventionCode: 'ECCIF-01',
    modeOfArrival: 'AMBULANCE', broughtBy: 'PARAMEDICS', referenceNumber: 'ER-001', practitionerIdentificationNumber: 'DOC-123',
    practitionerIdentificationType: 'registration_number', regulationBody: 'KMPDC',
  };
}

async function createEmergencyCaseFixture(identityStatus: 'identified' | 'unidentified') {
  const fixture = await createFixture();
  const claim = await fixture.medplum.createResource<Claim>({
    resourceType: 'Claim', status: 'draft', type: { text: 'ECCIF emergency claim' }, use: 'claim', patient: createReference(fixture.patient),
    created: new Date().toISOString(), provider: createReference(fixture.practitionerRole), priority: { text: 'stat' },
    identifier: [{ system: KHIE_CONSENT_TOKEN_SYSTEM, value: 'eccif-token' }],
  });
  const task = await fixture.medplum.createResource<Task>({
    resourceType: 'Task', status: 'in-progress', intent: 'order', focus: createReference(claim), for: createReference(fixture.patient),
    businessStatus: { coding: [{ system: KHIE_PAYER_CASE_STATUS_SYSTEM, code: 'doctor-consent-pending' }] },
    input: [
      { type: { text: 'KHIE intervention code' }, valueString: 'ECCIF-01' },
      { type: { text: 'KHIE ECCIF patient status' }, valueString: identityStatus },
    ],
  });
  return {
    ...fixture,
    claim,
    task,
    input: {
      patient: createReference(fixture.patient), practitionerRole: createReference(fixture.practitionerRole), selectedLocation: createReference(fixture.location),
      taskId: task.id as string, claimId: claim.id as string,
    } satisfies EccifEmergencyPayerCaseInput,
  };
}

function botEvent<T>(input: T): BotEvent<T> {
  return { bot: { reference: 'Bot/khie-eccif' }, input, contentType: 'application/fhir+json', secrets };
}

async function expectTaskStatus(medplum: MockClient, taskId: string, code: string, status?: Task['status']): Promise<void> {
  await expect(medplum.readResource('Task', taskId)).resolves.toMatchObject({
    ...(status ? { status } : {}),
    businessStatus: { coding: [expect.objectContaining({ code })] },
  });
}