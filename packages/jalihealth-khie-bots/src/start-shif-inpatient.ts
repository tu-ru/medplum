// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import { createReference, type BotEvent, type MedplumClient } from '@medplum/core';
import type { Claim, Coverage, Encounter, Task } from '@medplum/fhirtypes';
import { KhieConfigurationError } from '@medplum/jalihealth-khie-core';
import { getKhieWorkflowContext } from './context';
import {
  KHIE_COVERAGE_SYSTEM,
  KHIE_PAYER_CASE_STATUS_SYSTEM,
  type KhieInpatientPaymentMechanism,
  type KhieWorkflowDependencies,
  type StartShifInpatientInput,
  type StartShifInpatientResult,
} from './types';

export function createStartShifInpatientHandler(dependencies: KhieWorkflowDependencies = {}) {
  return async function handler(
    medplum: MedplumClient,
    event: BotEvent<StartShifInpatientInput>
  ): Promise<StartShifInpatientResult> {
    const context = await getKhieWorkflowContext(medplum, event, event.input, dependencies);
    const eligibility = await context.client.getEligibility(event.input.identificationNumber, event.input.identificationType);
    const khiePatientId = eligibility.memberCrNumber;
    if (!khiePatientId) {
      throw new KhieConfigurationError('KHIE eligibility response did not include a member CR number');
    }

    const interventions = await context.client.getInterventions(khiePatientId);
    const intervention = interventions.find(
      (candidate) =>
        candidate.interventionCode === event.input.interventionCode &&
        candidate.fund === 'SHIF' &&
        candidate.accessPoint === 'IP' &&
        (candidate.paymentMechanism === 'PER_DIEM' || candidate.paymentMechanism === 'FEE_FOR_SERVICE') &&
        (event.input.paymentMechanism === undefined || candidate.paymentMechanism === event.input.paymentMechanism)
    );
    if (!intervention || !intervention.paymentMechanism) {
      throw new KhieConfigurationError('The selected intervention is not an eligible SHIF inpatient intervention');
    }

    const paymentMechanism = intervention.paymentMechanism as KhieInpatientPaymentMechanism;
    if (paymentMechanism === 'PER_DIEM' && intervention.needsPreauth) {
      throw new KhieConfigurationError('A SHIF inpatient per-diem intervention cannot require preauthorization');
    }
    if (paymentMechanism === 'FEE_FOR_SERVICE' && !intervention.needsPreauth) {
      throw new KhieConfigurationError('A SHIF inpatient fee-for-service intervention requires preauthorization');
    }

    const preauthPath = paymentMechanism === 'FEE_FOR_SERVICE'
      ? intervention.needsManualPreauthApproval ? 'elective' : 'same-day'
      : undefined;
    const encounter = context.encounter ?? (await medplum.createResource<Encounter>({
      resourceType: 'Encounter',
      status: preauthPath === 'elective' ? 'planned' : 'in-progress',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'IMP' },
      subject: createReference(context.patient),
      participant: [{ individual: createReference(context.practitionerRole) }],
      location: [{ location: createReference(context.facility.facility), status: preauthPath === 'elective' ? 'planned' : 'active' }],
    }));
    const coverage = await medplum.createResource<Coverage>({
      resourceType: 'Coverage',
      status: 'active',
      type: { text: paymentMechanism === 'PER_DIEM' ? 'SHIF inpatient per diem' : 'SHIF inpatient fee-for-service' },
      identifier: [{ system: KHIE_COVERAGE_SYSTEM, value: khiePatientId }],
      subscriberId: khiePatientId,
      beneficiary: createReference(context.patient),
      subscriber: createReference(context.patient),
      relationship: { coding: [{ code: 'self' }] },
    });
    const claim = await medplum.createResource<Claim>({
      resourceType: 'Claim',
      status: 'draft',
      type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/claim-type', code: 'institutional' }] },
      subType: { text: paymentMechanism === 'PER_DIEM' ? 'SHIF inpatient per diem' : 'SHIF inpatient fee-for-service' },
      use: 'claim',
      patient: createReference(context.patient),
      created: new Date().toISOString(),
      provider: createReference(context.practitionerRole),
      facility: createReference(context.facility.facility),
      priority: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/processpriority', code: 'normal' }] },
      insurance: [{ sequence: 1, focal: true, coverage: createReference(coverage) }],
    });
    const task = await medplum.createResource<Task>({
      resourceType: 'Task',
      status: 'ready',
      intent: 'order',
      code: { coding: [{ system: KHIE_PAYER_CASE_STATUS_SYSTEM, code: 'shif-ip', display: 'SHIF inpatient' }] },
      businessStatus: {
        coding: [{
          system: KHIE_PAYER_CASE_STATUS_SYSTEM,
          code: paymentMechanism === 'PER_DIEM' ? 'admission-consent-required' : `${preauthPath}-preauth-required`,
          display: paymentMechanism === 'PER_DIEM'
            ? 'Admission consent required'
            : preauthPath === 'elective' ? 'Elective preauthorization required' : 'Same-day preauthorization required',
        }],
      },
      focus: createReference(claim),
      for: createReference(context.patient),
      encounter: createReference(encounter),
      authoredOn: new Date().toISOString(),
      input: [
        { type: { text: 'KHIE patient ID' }, valueString: khiePatientId },
        { type: { text: 'KHIE intervention code' }, valueString: intervention.interventionCode },
        { type: { text: 'KHIE payment mechanism' }, valueString: paymentMechanism },
        ...(preauthPath ? [{ type: { text: 'KHIE preauthorization path' }, valueString: preauthPath }] : []),
        { type: { text: 'KHIE facility code' }, valueString: context.facility.code },
      ],
    });
    if (!task.id || !claim.id || !coverage.id) {
      throw new Error('Medplum did not assign IDs to the SHIF inpatient workflow resources');
    }
    return { encounter, taskId: task.id, claimId: claim.id, coverageId: coverage.id, khiePatientId, paymentMechanism, preauthPath };
  };
}

export const handler = createStartShifInpatientHandler();