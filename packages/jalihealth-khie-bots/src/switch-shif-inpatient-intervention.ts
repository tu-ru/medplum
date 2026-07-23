// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import { getReferenceString, type BotEvent, type MedplumClient } from '@medplum/core';
import { getKhieWorkflowContext } from './context';
import { getConsentToken, getPayerCase } from './payer-case';
import type { KhieWorkflowDependencies, SwitchShifInpatientInterventionInput } from './types';

export function createSwitchShifInpatientInterventionHandler(dependencies: KhieWorkflowDependencies = {}) {
  return async function handler(medplum: MedplumClient, event: BotEvent<SwitchShifInpatientInterventionInput>) {
    const context = await getKhieWorkflowContext(medplum, event, event.input, dependencies);
    const encounter = context.encounter;
    if (!encounter || encounter.subject?.reference !== event.input.patient.reference) {
      throw new Error('The inpatient payer case requires an encounter for the selected patient');
    }
    if (encounter.status !== 'in-progress') {
      throw new Error('Ward transfers require an in-progress inpatient encounter');
    }
    if (encounter.location?.some((entry) => entry.status === 'active' && getReferenceString(entry.location) === getReferenceString(event.input.selectedLocation))) {
      throw new Error('The patient is already assigned to the selected ward or bed');
    }

    const payerCase = await getPayerCase(medplum, event.input);
    const result = await context.client.switchIntervention({
      consent_token: getConsentToken(payerCase.claim),
      intervention_code: event.input.interventionCode,
    });
    const transferTime = new Date().toISOString();
    const updatedEncounter = await medplum.updateResource({
      ...encounter,
      location: [
        ...(encounter.location?.map((entry) => entry.status === 'active'
          ? { ...entry, status: 'completed' as const, period: { ...entry.period, end: transferTime } }
          : entry) ?? []),
        { location: event.input.selectedLocation, status: 'active', period: { start: transferTime } },
      ],
    });
    const updatedTask = await medplum.updateResource({
      ...payerCase.task,
      input: payerCase.task.input?.map((item) => item.type.text === 'KHIE intervention code'
        ? { ...item, valueString: event.input.interventionCode }
        : item),
    });
    return { result, encounter: updatedEncounter, task: updatedTask };
  };
}

export const handler = createSwitchShifInpatientInterventionHandler();