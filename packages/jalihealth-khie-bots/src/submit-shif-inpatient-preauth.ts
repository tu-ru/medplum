// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { BotEvent, MedplumClient } from '@medplum/core';
import { getKhieWorkflowContext } from './context';
import { getConsentToken, getPayerCase, getPayerCaseInput, setPayerCaseStatus } from './payer-case';
import type { KhieWorkflowDependencies, SubmitShifInpatientPreauthInput } from './types';

export function createSubmitShifInpatientPreauthHandler(dependencies: KhieWorkflowDependencies = {}) {
  return async function handler(medplum: MedplumClient, event: BotEvent<SubmitShifInpatientPreauthInput>) {
    const context = await getKhieWorkflowContext(medplum, event, event.input, dependencies);
    const payerCase = await getPayerCase(medplum, event.input);
    if (getPayerCaseInput(payerCase.task, 'KHIE payment mechanism') !== 'FEE_FOR_SERVICE') {
      throw new Error('Preauthorization is not available for SHIF inpatient per-diem cases');
    }
    const preauthPath = getPayerCaseInput(payerCase.task, 'KHIE preauthorization path');
    const status = payerCase.task.businessStatus?.coding?.[0]?.code;
    if (preauthPath === 'same-day' && status !== 'visit-started') {
      throw new Error('A same-day SHIF inpatient FFS preauthorization requires an active visit');
    }
    if (preauthPath === 'elective' && status !== 'preauth-authorization-created') {
      throw new Error('An elective SHIF inpatient FFS preauthorization requires pre-visit consent');
    }
    const result = await context.client.createPreauth({
      ...event.input.preauth,
      consent_token: getConsentToken(payerCase.claim),
      intervention_code: getPayerCaseInput(payerCase.task, 'KHIE intervention code'),
      service_type: 'INPATIENT',
    });
    await setPayerCaseStatus(medplum, payerCase.task, 'in-progress', 'preauth-submitted', 'Preauthorization submitted');
    return result;
  };
}

export const handler = createSubmitShifInpatientPreauthHandler();