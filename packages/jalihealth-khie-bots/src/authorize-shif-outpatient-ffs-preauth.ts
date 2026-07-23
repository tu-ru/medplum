// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { BotEvent, MedplumClient } from '@medplum/core';
import { getKhieWorkflowContext } from './context';
import { getPayerCase, getPayerCaseInput, saveConsentToken, setPayerCaseStatus } from './payer-case';
import type { AuthorizeShifOutpatientFfsPreauthInput, KhieWorkflowDependencies } from './types';

export function createAuthorizeShifOutpatientFfsPreauthHandler(dependencies: KhieWorkflowDependencies = {}) {
  return async function handler(medplum: MedplumClient, event: BotEvent<AuthorizeShifOutpatientFfsPreauthInput>) {
    const context = await getKhieWorkflowContext(medplum, event, event.input, dependencies);
    const payerCase = await getPayerCase(medplum, event.input);
    if (getPayerCaseInput(payerCase.task, 'KHIE preauthorization path') !== 'elective') {
      throw new Error('Pre-visit authorization is only available for elective SHIF outpatient FFS cases');
    }
    const result = await context.client.authorize({
      ...event.input.authorization,
      patient_id: payerCase.khiePatientId,
      intervention_codes: [getPayerCaseInput(payerCase.task, 'KHIE intervention code')],
      service_type: 'OUTPATIENT',
      is_elective: true,
    });
    const consentToken = result.token;
    if (typeof consentToken !== 'string' || !consentToken) {
      throw new Error('KHIE authorization response did not include a consent token');
    }
    await saveConsentToken(medplum, payerCase.claim, consentToken);
    await setPayerCaseStatus(medplum, payerCase.task, 'in-progress', 'preauth-authorization-created', 'Preauthorization consent created');
    return { consentTokenStored: true, authorization: result };
  };
}

export const handler = createAuthorizeShifOutpatientFfsPreauthHandler();