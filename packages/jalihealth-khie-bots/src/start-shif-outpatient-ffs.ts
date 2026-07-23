// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import { createReference, type BotEvent, type MedplumClient } from '@medplum/core';
import type { Claim, Coverage, Encounter, Task } from '@medplum/fhirtypes';
import { KhieConfigurationError } from '@medplum/jalihealth-khie-core';
import { getKhieWorkflowContext } from './context';
import {
    KHIE_COVERAGE_SYSTEM,
    KHIE_PAYER_CASE_STATUS_SYSTEM,
    type KhieWorkflowDependencies,
    type StartShifOutpatientFfsInput,
    type StartShifOutpatientFfsResult,
} from './types';

export function createStartShifOutpatientFfsHandler(dependencies: KhieWorkflowDependencies = {}) {
  return async function handler(
    medplum: MedplumClient,
    event: BotEvent<StartShifOutpatientFfsInput>
  ): Promise<StartShifOutpatientFfsResult> {
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
        candidate.accessPoint === 'OP' &&
        candidate.paymentMechanism === 'FEE_FOR_SERVICE' &&
        candidate.needsPreauth
    );
    if (!intervention) {
      throw new KhieConfigurationError('The selected intervention is not an eligible SHIF outpatient fee-for-service preauthorization');
    }
    const preauthPath = intervention.needsManualPreauthApproval ? 'elective' : 'same-day';
    const encounter = context.encounter ?? (await medplum.createResource<Encounter>({
      resourceType: 'Encounter',
      status: preauthPath === 'elective' ? 'planned' : 'in-progress',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
      subject: createReference(context.patient),
      participant: [{ individual: createReference(context.practitionerRole) }],
      location: [{ location: createReference(context.facility.facility), status: 'planned' }],
    }));
    const coverage = await medplum.createResource<Coverage>({
      resourceType: 'Coverage',
      status: 'active',
      type: { text: 'SHIF outpatient fee-for-service' },
      identifier: [{ system: KHIE_COVERAGE_SYSTEM, value: khiePatientId }],
      subscriberId: khiePatientId,
      beneficiary: createReference(context.patient),
      subscriber: createReference(context.patient),
      relationship: { coding: [{ code: 'self' }] },
    });
    const claim = await medplum.createResource<Claim>({
      resourceType: 'Claim',
      status: 'draft',
      type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/claim-type', code: 'professional' }] },
      subType: { text: 'SHIF outpatient fee-for-service' },
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
      code: { coding: [{ system: KHIE_PAYER_CASE_STATUS_SYSTEM, code: 'shif-op-ffs', display: 'SHIF outpatient fee-for-service' }] },
      businessStatus: {
        coding: [
          {
            system: KHIE_PAYER_CASE_STATUS_SYSTEM,
            code: preauthPath === 'elective' ? 'elective-preauth-required' : 'same-day-preauth-required',
            display: preauthPath === 'elective' ? 'Elective preauthorization required' : 'Same-day preauthorization required',
          },
        ],
      },
      focus: createReference(claim),
      for: createReference(context.patient),
      encounter: createReference(encounter),
      authoredOn: new Date().toISOString(),
      input: [
        { type: { text: 'KHIE patient ID' }, valueString: khiePatientId },
        { type: { text: 'KHIE intervention code' }, valueString: intervention.interventionCode },
        { type: { text: 'KHIE preauthorization path' }, valueString: preauthPath },
        { type: { text: 'KHIE facility code' }, valueString: context.facility.code },
      ],
    });
    if (!task.id || !claim.id || !coverage.id) {
      throw new Error('Medplum did not assign IDs to the SHIF FFS workflow resources');
    }
    return { encounter, taskId: task.id, claimId: claim.id, coverageId: coverage.id, khiePatientId, preauthPath };
  };
}

export const handler = createStartShifOutpatientFfsHandler();