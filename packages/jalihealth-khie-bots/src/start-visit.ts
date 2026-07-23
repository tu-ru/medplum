// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import { createReference, type BotEvent, type MedplumClient } from '@medplum/core';
import type { Claim, Coverage, Encounter, Task } from '@medplum/fhirtypes';
import { KhieConfigurationError } from '@medplum/jalihealth-khie-core';
import { getKhieWorkflowContext } from './context';
import { KHIE_COVERAGE_SYSTEM, KHIE_PAYER_CASE_STATUS_SYSTEM, type KhieWorkflowDependencies, type StartUhcVisitInput, type StartUhcVisitResult } from './types';

export function createStartUhcVisitHandler(dependencies: KhieWorkflowDependencies = {}) {
  return async function handler(medplum: MedplumClient, event: BotEvent<StartUhcVisitInput>): Promise<StartUhcVisitResult> {
    const input = event.input;
    const context = await getKhieWorkflowContext(medplum, event, input, dependencies);
    const eligibility = await context.client.getEligibility(input.identificationNumber, input.identificationType);
    const khiePatientId = eligibility.memberCrNumber;
    if (!khiePatientId) {
      throw new KhieConfigurationError('KHIE eligibility response did not include a member CR number');
    }

    const interventions = await context.client.getInterventions(khiePatientId);
    const intervention = interventions.find(
      (candidate) =>
        candidate.fund === 'UHC' &&
        candidate.paymentMechanism === 'CAPITATION' &&
        !candidate.needsPreauth &&
        !candidate.needsManualPreauthApproval
    );
    if (!intervention) {
      throw new KhieConfigurationError('No eligible UHC outpatient capitation intervention is available for this patient');
    }

    const encounter = context.encounter ?? (await medplum.createResource<Encounter>({
      resourceType: 'Encounter',
      status: 'in-progress',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
      subject: createReference(context.patient),
      participant: [{ individual: createReference(context.practitionerRole) }],
      location: [{ location: createReference(context.facility.facility), status: 'active' }],
    }));
    const coverage = await medplum.createResource<Coverage>({
      resourceType: 'Coverage',
      status: 'active',
      type: { text: 'UHC outpatient capitation' },
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
      subType: { text: 'UHC outpatient capitation' },
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
      code: { coding: [{ system: KHIE_PAYER_CASE_STATUS_SYSTEM, code: 'uhc-outpatient-capitation', display: 'UHC outpatient capitation' }] },
      businessStatus: { coding: [{ system: KHIE_PAYER_CASE_STATUS_SYSTEM, code: 'eligibility-confirmed', display: 'Eligibility confirmed' }] },
      focus: createReference(claim),
      for: createReference(context.patient),
      encounter: createReference(encounter),
      authoredOn: new Date().toISOString(),
      input: [
        { type: { text: 'KHIE patient ID' }, valueString: khiePatientId },
        { type: { text: 'KHIE intervention code' }, valueString: intervention.interventionCode },
        { type: { text: 'KHIE facility code' }, valueString: context.facility.code },
      ],
    });

    if (!task.id || !claim.id || !coverage.id) {
      throw new Error('Medplum did not assign IDs to the UHC workflow resources');
    }
    return { encounter, taskId: task.id, claimId: claim.id, coverageId: coverage.id, khiePatientId };
  };
}

export const handler = createStartUhcVisitHandler();