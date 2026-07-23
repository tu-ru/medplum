// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import { createReference, type BotEvent, type MedplumClient } from '@medplum/core';
import type { Claim, Patient, Task } from '@medplum/fhirtypes';
import { getKhieWorkflowContext } from './context';
import { KHIE_CONSENT_TOKEN_SYSTEM, KHIE_PAYER_CASE_STATUS_SYSTEM, type CreateEccifEmergencyClaimInput, type CreateEccifEmergencyClaimResult, type KhieWorkflowDependencies } from './types';

export function createCreateEccifEmergencyClaimHandler(dependencies: KhieWorkflowDependencies = {}) {
  return async function handler(
    medplum: MedplumClient,
    event: BotEvent<CreateEccifEmergencyClaimInput>
  ): Promise<CreateEccifEmergencyClaimResult> {
    const identified = Boolean(event.input.beneficiaryCrId || event.input.otp);
    if (identified && (!event.input.patient || !event.input.beneficiaryCrId || !event.input.otp)) {
      throw new Error('An identified ECCIF emergency claim requires a patient, beneficiary CR ID, and OTP');
    }
    if (!identified && event.input.patient) {
      throw new Error('An unidentified ECCIF emergency claim must not include a patient identity');
    }
    const patient = event.input.patient
      ? await medplum.readReference(event.input.patient)
      : await medplum.createResource<Patient>({ resourceType: 'Patient', active: true, name: [{ text: 'Unidentified emergency patient' }] });
    const context = await getKhieWorkflowContext(medplum, event, { ...event.input, patient: createReference(patient) }, dependencies);
    const response = await context.client.createEmergencyClaim({
      interventions: [event.input.interventionCode],
      mode_of_arrival: event.input.modeOfArrival,
      brought_by: event.input.broughtBy,
      reference_number: event.input.referenceNumber,
      identification_number: event.input.practitionerIdentificationNumber,
      identification_type: event.input.practitionerIdentificationType,
      regulation_body: event.input.regulationBody,
      ...(event.input.notes ? { notes: event.input.notes } : {}),
      ...(identified ? { beneficiary_cr_id: event.input.beneficiaryCrId, otp: event.input.otp } : {}),
    });
    const consentToken = response.authorization_code;
    if (typeof consentToken !== 'string' || !consentToken) {
      throw new Error('KHIE ECCIF emergency claim response did not include an authorization code');
    }
    const claim = await medplum.createResource<Claim>({
      resourceType: 'Claim',
      status: 'draft',
      type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/claim-type', code: 'professional' }] },
      subType: { text: 'ECCIF emergency claim' },
      use: 'claim',
      patient: createReference(patient),
      created: new Date().toISOString(),
      provider: createReference(context.practitionerRole),
      facility: createReference(context.facility.facility),
      priority: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/processpriority', code: 'stat' }] },
      identifier: [{ system: KHIE_CONSENT_TOKEN_SYSTEM, value: consentToken }],
    });
    const task = await medplum.createResource<Task>({
      resourceType: 'Task',
      status: 'in-progress',
      intent: 'order',
      code: { coding: [{ system: KHIE_PAYER_CASE_STATUS_SYSTEM, code: 'eccif-emergency', display: 'ECCIF emergency claim' }] },
      businessStatus: { coding: [{ system: KHIE_PAYER_CASE_STATUS_SYSTEM, code: 'doctor-consent-pending', display: 'Doctor consent pending' }] },
      focus: createReference(claim),
      for: createReference(patient),
      authoredOn: new Date().toISOString(),
      input: [
        { type: { text: 'KHIE intervention code' }, valueString: event.input.interventionCode },
        { type: { text: 'KHIE ECCIF patient status' }, valueString: identified ? 'identified' : 'unidentified' },
        ...(identified ? [{ type: { text: 'KHIE patient ID' }, valueString: event.input.beneficiaryCrId }] : []),
        { type: { text: 'KHIE facility code' }, valueString: context.facility.code },
      ],
    });
    if (!claim.id || !task.id) {
      throw new Error('Medplum did not assign IDs to the ECCIF emergency claim resources');
    }
    return { patient, claimId: claim.id, taskId: task.id, consentTokenStored: true, unidentified: !identified };
  };
}

export const handler = createCreateEccifEmergencyClaimHandler();