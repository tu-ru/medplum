// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { BotEvent, MedplumClient } from '@medplum/core';
import { getKhieWorkflowContext } from './context';
import { getEccifCaseInput, getEccifConsentToken, getEccifEmergencyCase } from './eccif-case';
import { setPayerCaseStatus } from './payer-case';
import type { KhieWorkflowDependencies, ResendEccifDoctorConsentInput } from './types';

export function createResendEccifDoctorConsentHandler(dependencies: KhieWorkflowDependencies = {}) {
  return async function handler(medplum: MedplumClient, event: BotEvent<ResendEccifDoctorConsentInput>) {
    const context = await getKhieWorkflowContext(medplum, event, event.input, dependencies);
    const payerCase = await getEccifEmergencyCase(medplum, event.input);
    const result = await context.client.sendDoctorConsent({
      consent_token: getEccifConsentToken(payerCase.claim),
      intervention_code: getEccifCaseInput(payerCase.task, 'KHIE intervention code'),
      identification_number: event.input.doctorIdentificationNumber,
      request_type: 'EMERGENCY_CLAIM_DOCTOR_APPROVAL_REQUEST',
    });
    await setPayerCaseStatus(medplum, payerCase.task, 'in-progress', 'doctor-consent-resent', 'Doctor consent resent');
    return result;
  };
}

export const handler = createResendEccifDoctorConsentHandler();