// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { BotEvent, MedplumClient } from '@medplum/core';
import { getKhieWorkflowContext } from './context';
import { getPayerCase, getPayerCaseInput, saveConsentToken, setPayerCaseStatus } from './payer-case';
import type { CreateShifInpatientVisitInput, KhieWorkflowDependencies } from './types';

export function createCreateShifInpatientVisitHandler(dependencies: KhieWorkflowDependencies = {}) {
  return async function handler(medplum: MedplumClient, event: BotEvent<CreateShifInpatientVisitInput>) {
    if (!event.input.otp && !event.input.authGuid) {
      throw new Error('An OTP or biometric authorization GUID is required to admit an inpatient');
    }
    const context = await getKhieWorkflowContext(medplum, event, event.input, dependencies);
    const payerCase = await getPayerCase(medplum, event.input);
    const paymentMechanism = getPayerCaseInput(payerCase.task, 'KHIE payment mechanism');
    const preauthPath = payerCase.task.input?.find((item) => item.type.text === 'KHIE preauthorization path')?.valueString;
    const status = payerCase.task.businessStatus?.coding?.[0]?.code;
    const canStartVisit =
      (paymentMechanism === 'PER_DIEM' && status === 'admission-consent-required') ||
      (paymentMechanism === 'FEE_FOR_SERVICE' && preauthPath === 'same-day' && status === 'same-day-preauth-required') ||
      (paymentMechanism === 'FEE_FOR_SERVICE' && preauthPath === 'elective' && status === 'preauth-finalized');
    if (!canStartVisit) {
      throw new Error('The inpatient payer case is not ready to create a visit');
    }
    const result = await context.client.createVisit({
      patient_id: payerCase.khiePatientId,
      intervention_code: getPayerCaseInput(payerCase.task, 'KHIE intervention code'),
      service_type: 'INPATIENT',
      ...(event.input.otp ? { otp: event.input.otp } : {}),
      ...(event.input.authGuid ? { auth_guid: event.input.authGuid } : {}),
    });
    const consentToken = result.consent_token;
    if (typeof consentToken !== 'string' || !consentToken) {
      throw new Error('KHIE inpatient visit response did not include a consent token');
    }
    await saveConsentToken(medplum, payerCase.claim, consentToken);
    await setPayerCaseStatus(medplum, payerCase.task, 'in-progress', 'visit-started', 'Inpatient visit started');
    return { consentTokenStored: true };
  };
}

export const handler = createCreateShifInpatientVisitHandler();