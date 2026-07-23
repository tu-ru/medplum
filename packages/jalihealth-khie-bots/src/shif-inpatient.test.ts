// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import { createReference, type BotEvent } from '@medplum/core';
import type { Claim, Location, Organization, Patient, Practitioner, PractitionerRole, Task } from '@medplum/fhirtypes';
import { KhieClient, setKhieFacilityIdentity } from '@medplum/jalihealth-khie-core';
import { MockClient } from '@medplum/mock';
import { describe, expect, test, vi } from 'vitest';
import { createAddShifInpatientBillingHandler } from './add-shif-inpatient-billing';
import { createAuthorizeShifInpatientPreauthHandler } from './authorize-shif-inpatient-preauth';
import { createCreateShifInpatientVisitHandler } from './create-shif-inpatient-visit';
import { createDischargeShifInpatientHandler } from './discharge-shif-inpatient';
import { createRefreshShifInpatientPreauthHandler } from './refresh-shif-inpatient-preauth';
import { createSendShifInpatientDischargeOtpHandler } from './send-shif-inpatient-discharge-otp';
import { createSubmitShifInpatientPreauthHandler } from './submit-shif-inpatient-preauth';
import { createSwitchShifInpatientInterventionHandler } from './switch-shif-inpatient-intervention';
import { KHIE_CONSENT_TOKEN_SYSTEM, KHIE_PAYER_CASE_STATUS_SYSTEM, type ShifInpatientPayerCaseInput } from './types';

const secrets: BotEvent['secrets'] = {
  KHIE_ENVIRONMENT: { name: 'KHIE_ENVIRONMENT', valueString: 'mock' },
  KHIE_CLIENT_ID: { name: 'KHIE_CLIENT_ID', valueString: 'client-123' },
  KHIE_CLIENT_SECRET: { name: 'KHIE_CLIENT_SECRET', valueString: 'secret-123' },
  KHIE_TOKEN_URL: { name: 'KHIE_TOKEN_URL', valueString: 'https://mock.khie.test/token' },
  KHIE_API_BASE_URL: { name: 'KHIE_API_BASE_URL', valueString: 'https://mock.khie.test/api/v1' },
};

describe('SHIF inpatient progression', () => {
  test('creates a per-diem visit, persists consent, and permits billing', async () => {
    const fixture = await createFixture('PER_DIEM', 'admission-consent-required');
    const client = {
      createVisit: vi.fn().mockResolvedValue({ consent_token: 'visit-consent-token' }),
      addClaimLines: vi.fn().mockResolvedValue({ accepted: true }),
    } as unknown as KhieClient;

    await createCreateShifInpatientVisitHandler({ createClient: () => client })(fixture.medplum, botEvent({ ...fixture.input, otp: '123456' }));

    expect(client.createVisit).toHaveBeenCalledWith({
      patient_id: 'CR-456', intervention_code: 'IP-PD-01', service_type: 'INPATIENT', otp: '123456',
    });
    await expectTaskStatus(fixture.medplum, fixture.task.id as string, 'visit-started');
    await expect(fixture.medplum.readResource('Claim', fixture.claim.id as string)).resolves.toMatchObject({
      identifier: [expect.objectContaining({ system: KHIE_CONSENT_TOKEN_SYSTEM, value: 'visit-consent-token' })],
    });

    await createAddShifInpatientBillingHandler({ createClient: () => client })(
      fixture.medplum,
      botEvent({ ...fixture.input, billing: { lines: [{ code: 'IP-DAY-01' }] } })
    );
    expect(client.addClaimLines).toHaveBeenCalledWith({
      lines: [{ code: 'IP-DAY-01' }], consent_token: 'visit-consent-token', intervention_code: 'IP-PD-01', service_type: 'INPATIENT',
    });
    await expectTaskStatus(fixture.medplum, fixture.task.id as string, 'billing-lines-added');
  });

  test('requires an active same-day FFS visit before submitting preauthorization', async () => {
    const fixture = await createFixture('FEE_FOR_SERVICE', 'same-day-preauth-required', 'same-day');
    const client = { createPreauth: vi.fn() } as unknown as KhieClient;

    await expect(
      createSubmitShifInpatientPreauthHandler({ createClient: () => client })(
        fixture.medplum,
        botEvent({ ...fixture.input, preauth: { diagnosis: 'J11.1' } })
      )
    ).rejects.toThrow('requires an active visit');
    expect(client.createPreauth).not.toHaveBeenCalled();
  });

  test('authorizes, submits, and finalizes an elective FFS preauthorization', async () => {
    const fixture = await createFixture('FEE_FOR_SERVICE', 'elective-preauth-required', 'elective');
    const client = {
      authorize: vi.fn().mockResolvedValue({ token: 'elective-consent-token' }),
      createPreauth: vi.fn().mockResolvedValue({ status: 'PENDING' }),
      getPreauthStatus: vi.fn().mockResolvedValue({ preauth: { status: 'FINALISED' } }),
    } as unknown as KhieClient;

    await createAuthorizeShifInpatientPreauthHandler({ createClient: () => client })(
      fixture.medplum,
      botEvent({ ...fixture.input, authorization: { diagnosis: 'J11.1' } })
    );
    expect(client.authorize).toHaveBeenCalledWith({
      diagnosis: 'J11.1', patient_id: 'CR-456', intervention_codes: ['IP-FFS-01'], service_type: 'INPATIENT', is_elective: true,
    });
    await expectTaskStatus(fixture.medplum, fixture.task.id as string, 'preauth-authorization-created');

    await createSubmitShifInpatientPreauthHandler({ createClient: () => client })(
      fixture.medplum,
      botEvent({ ...fixture.input, preauth: { diagnosis: 'J11.1' } })
    );
    expect(client.createPreauth).toHaveBeenCalledWith({
      diagnosis: 'J11.1', consent_token: 'elective-consent-token', intervention_code: 'IP-FFS-01', service_type: 'INPATIENT',
    });

    await createRefreshShifInpatientPreauthHandler({ createClient: () => client })(fixture.medplum, botEvent(fixture.input));
    await expectTaskStatus(fixture.medplum, fixture.task.id as string, 'preauth-finalized');
  });

  test('rejects FFS billing until preauthorization is finalised', async () => {
    const fixture = await createFixture('FEE_FOR_SERVICE', 'preauth-pending', 'same-day');
    const client = { addClaimLines: vi.fn() } as unknown as KhieClient;

    await expect(
      createAddShifInpatientBillingHandler({ createClient: () => client })(
        fixture.medplum,
        botEvent({ ...fixture.input, billing: { lines: [{ code: 'IP-FFS-01' }] } })
      )
    ).rejects.toThrow('requires a finalised preauthorization');
    expect(client.addClaimLines).not.toHaveBeenCalled();
  });

  test('switches the inpatient intervention and records ward location history', async () => {
    const fixture = await createFixture('PER_DIEM', 'visit-started', undefined, true);
    const destination = await fixture.medplum.createResource<Location>({ resourceType: 'Location', name: 'Surgical Ward' });
    const client = { switchIntervention: vi.fn().mockResolvedValue({ accepted: true }) } as unknown as KhieClient;

    await createSwitchShifInpatientInterventionHandler({ createClient: () => client })(fixture.medplum, botEvent({
      ...fixture.input,
      encounter: createReference(fixture.encounter),
      selectedLocation: createReference(destination),
      interventionCode: 'IP-PD-02',
    }));

    expect(client.switchIntervention).toHaveBeenCalledWith({ consent_token: 'server-consent-token', intervention_code: 'IP-PD-02' });
    await expect(fixture.medplum.readResource('Encounter', fixture.encounter.id as string)).resolves.toMatchObject({
      location: [
        expect.objectContaining({ location: createReference(fixture.location), status: 'completed', period: expect.objectContaining({ end: expect.any(String) }) }),
        expect.objectContaining({ location: createReference(destination), status: 'active', period: expect.objectContaining({ start: expect.any(String) }) }),
      ],
    });
    await expect(fixture.medplum.readResource('Task', fixture.task.id as string)).resolves.toMatchObject({
      input: expect.arrayContaining([expect.objectContaining({ type: { text: 'KHIE intervention code' }, valueString: 'IP-PD-02' })]),
    });
  });

  test('validates discharge contacts before sending an OTP', async () => {
    const fixture = await createFixture('PER_DIEM', 'billing-lines-added');
    const client = {
      getPatientContacts: vi.fn().mockResolvedValue([{ contact_id: 42 }]),
      sendDischargeOtp: vi.fn().mockResolvedValue({ sent: true }),
    } as unknown as KhieClient;
    const handler = createSendShifInpatientDischargeOtpHandler({ createClient: () => client });

    await expect(handler(fixture.medplum, botEvent({ ...fixture.input, contactId: 7 }))).rejects.toThrow('selected contact is not available');
    await handler(fixture.medplum, botEvent({ ...fixture.input, contactId: 42 }));

    expect(client.sendDischargeOtp).toHaveBeenCalledWith({
      consent_token: 'server-consent-token', beneficiary_cr_id: 'CR-456', beneficiary_contact_id: 42, otp_type: 'discharge',
    });
    await expectTaskStatus(fixture.medplum, fixture.task.id as string, 'discharge-otp-sent');
  });

  test('requires deceased next-of-kin details and completes a valid biometric discharge', async () => {
    const fixture = await createFixture('PER_DIEM', 'billing-lines-added');
    const client = {
      previewClaim: vi.fn().mockResolvedValue({ total: 1250 }),
      dischargePatient: vi.fn().mockResolvedValue({ reference: 'DISCHARGE-123' }),
    } as unknown as KhieClient;
    const handler = createDischargeShifInpatientHandler({ createClient: () => client });
    const discharge = { dischargeDate: '2026-02-10', dischargeReason: 'DECEASED', invoiceNumber: 'INV-001', authGuid: 'bio-123' };

    await expect(handler(fixture.medplum, botEvent({ ...fixture.input, ...discharge }))).rejects.toThrow('Next-of-kin details are required');

    const result = await handler(fixture.medplum, botEvent({
      ...fixture.input,
      ...discharge,
      nextOfKinFullName: 'Jane Doe',
      nextOfKinIdNumber: '12345678',
      nextOfKinIdNumberType: 'national-id',
      contactValue: '+254700000000',
    }));

    expect(result).toEqual({ preview: { total: 1250 }, discharge: { reference: 'DISCHARGE-123' } });
    expect(client.previewClaim).toHaveBeenCalledWith('server-consent-token');
    expect(client.dischargePatient).toHaveBeenCalledWith(expect.objectContaining({
      consent_token: 'server-consent-token', beneficiary_cr_id: 'CR-456', auth_guid: 'bio-123', is_alive: false,
      next_of_kin_full_name: 'Jane Doe', next_of_kin_id_number: '12345678', next_of_kin_id_number_type: 'national-id', contact_value: '+254700000000',
    }));
    await expect(fixture.medplum.readResource('Claim', fixture.claim.id as string)).resolves.toMatchObject({ status: 'active' });
    await expectTaskStatus(fixture.medplum, fixture.task.id as string, 'claim-submitted', 'completed');
  });
});

async function createFixture(
  paymentMechanism: 'PER_DIEM' | 'FEE_FOR_SERVICE',
  businessStatus: string,
  preauthPath?: 'same-day' | 'elective',
  createEncounter = false
) {
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
  const encounter = createEncounter ? await medplum.createResource({
    resourceType: 'Encounter',
    status: 'in-progress',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'IMP' },
    subject: createReference(patient),
    location: [{ location: createReference(location), status: 'active' }],
  }) : undefined;
  const claim = await medplum.createResource<Claim>({
    resourceType: 'Claim', status: 'draft', type: { text: 'SHIF inpatient' }, use: 'claim', patient: createReference(patient),
    created: new Date().toISOString(), provider: createReference(practitionerRole), priority: { text: 'normal' },
    identifier: [{ system: KHIE_CONSENT_TOKEN_SYSTEM, value: 'server-consent-token' }],
  });
  const task = await medplum.createResource<Task>({
    resourceType: 'Task', status: 'in-progress', intent: 'order', focus: createReference(claim), for: createReference(patient),
    businessStatus: { coding: [{ system: KHIE_PAYER_CASE_STATUS_SYSTEM, code: businessStatus }] },
    input: [
      { type: { text: 'KHIE patient ID' }, valueString: 'CR-456' },
      { type: { text: 'KHIE intervention code' }, valueString: paymentMechanism === 'PER_DIEM' ? 'IP-PD-01' : 'IP-FFS-01' },
      { type: { text: 'KHIE payment mechanism' }, valueString: paymentMechanism },
      ...(preauthPath ? [{ type: { text: 'KHIE preauthorization path' }, valueString: preauthPath }] : []),
    ],
  });
  return {
    medplum,
    task,
    claim,
    location,
    encounter,
    input: {
      patient: createReference(patient), practitionerRole: createReference(practitionerRole), taskId: task.id as string,
      claimId: claim.id as string, selectedLocation: createReference(location),
    } satisfies ShifInpatientPayerCaseInput,
  };
}

function botEvent<T extends ShifInpatientPayerCaseInput>(input: T): BotEvent<T> {
  return { bot: { reference: 'Bot/khie-shif' }, input, contentType: 'application/fhir+json', secrets };
}

async function expectTaskStatus(medplum: MockClient, taskId: string, code: string, status?: Task['status']): Promise<void> {
  await expect(medplum.readResource('Task', taskId)).resolves.toMatchObject({
    ...(status ? { status } : {}),
    businessStatus: { coding: [expect.objectContaining({ code })] },
  });
}