// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import { createReference, getReferenceString, type BotEvent, type MedplumClient } from '@medplum/core';
import { getKhieWorkflowContext } from './context';
import { getEccifCaseInput, getEccifConsentToken } from './eccif-case';
import { KHIE_PAYER_CASE_STATUS_SYSTEM, type IdentifyEccifEmergencyPatientInput, type KhieWorkflowDependencies } from './types';

export function createIdentifyEccifEmergencyPatientHandler(dependencies: KhieWorkflowDependencies = {}) {
  return async function handler(medplum: MedplumClient, event: BotEvent<IdentifyEccifEmergencyPatientInput>) {
    const context = await getKhieWorkflowContext(medplum, event, event.input, dependencies);
    const [claim, task] = await Promise.all([
      medplum.readResource('Claim', event.input.claimId),
      medplum.readResource('Task', event.input.taskId),
    ]);
    if (getReferenceString(task.focus) !== `Claim/${claim.id}` || getEccifCaseInput(task, 'KHIE ECCIF patient status') !== 'unidentified') {
      throw new Error('Only an unidentified ECCIF emergency claim can be linked to a patient');
    }
    const result = await context.client.createEmergencyClaim({
      consent_token: getEccifConsentToken(claim),
      beneficiary_cr_id: event.input.beneficiaryCrId,
      otp: event.input.otp,
    });
    const updatedClaim = await medplum.updateResource({ ...claim, patient: createReference(context.patient) });
    const updatedTask = await medplum.updateResource({
      ...task,
      for: createReference(context.patient),
      status: 'in-progress',
      businessStatus: { coding: [{ system: KHIE_PAYER_CASE_STATUS_SYSTEM, code: 'patient-identified', display: 'Emergency patient identified' }] },
      input: [
        ...(task.input?.filter((item) => item.type.text !== 'KHIE ECCIF patient status' && item.type.text !== 'KHIE patient ID') ?? []),
        { type: { text: 'KHIE ECCIF patient status' }, valueString: 'identified' },
        { type: { text: 'KHIE patient ID' }, valueString: event.input.beneficiaryCrId },
      ],
    });
    return { result, claim: updatedClaim, task: updatedTask };
  };
}

export const handler = createIdentifyEccifEmergencyPatientHandler();