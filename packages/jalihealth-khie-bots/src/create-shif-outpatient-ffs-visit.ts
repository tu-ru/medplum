// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { BotEvent, MedplumClient } from '@medplum/core';
import { getKhieWorkflowContext } from './context';
import { getPayerCase, getPayerCaseInput, saveConsentToken, setPayerCaseStatus } from './payer-case';
import type { CreateShifOutpatientFfsVisitInput, KhieWorkflowDependencies } from './types';

export function createCreateShifOutpatientFfsVisitHandler(dependencies: KhieWorkflowDependencies = {}) {
  return async function handler(medplum: MedplumClient, event: BotEvent<CreateShifOutpatientFfsVisitInput>) {
    if (!event.input.otp && !event.input.authGuid) {
      throw new Error('An OTP or biometric authorization GUID is required to create a visit');
    }
    const context = await getKhieWorkflowContext(medplum, event, event.input, dependencies);
    const payerCase = await getPayerCase(medplum, event.input);
    const preauthPath = getPayerCaseInput(payerCase.task, 'KHIE preauthorization path');
    const status = payerCase.task.businessStatus?.coding?.[0]?.code;
    if (preauthPath === 'elective' && status !== 'preauth-finalized') {
      throw new Error('An elective SHIF outpatient FFS visit requires a finalised preauthorization');
    }
    const result = await context.client.createVisit({
      patient_id: payerCase.khiePatientId,
      intervention_code: getPayerCaseInput(payerCase.task, 'KHIE intervention code'),
      service_type: 'OUTPATIENT',
      ...(event.input.otp ? { otp: event.input.otp } : {}),
      ...(event.input.authGuid ? { auth_guid: event.input.authGuid } : {}),
    });
    const consentToken = result.consent_token;
    if (typeof consentToken !== 'string' || !consentToken) {
      throw new Error('KHIE visit response did not include a consent token');
    }
    await saveConsentToken(medplum, payerCase.claim, consentToken);
    await setPayerCaseStatus(medplum, payerCase.task, 'in-progress', 'visit-started', 'Visit started');
    return { consentTokenStored: true };
  };
}

export const handler = createCreateShifOutpatientFfsVisitHandler();