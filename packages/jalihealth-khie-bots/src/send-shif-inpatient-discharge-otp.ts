// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { BotEvent, MedplumClient } from '@medplum/core';
import { getKhieWorkflowContext } from './context';
import { getConsentToken, getPayerCase, setPayerCaseStatus } from './payer-case';
import type { KhieWorkflowDependencies, SendShifInpatientDischargeOtpInput } from './types';

export function createSendShifInpatientDischargeOtpHandler(dependencies: KhieWorkflowDependencies = {}) {
  return async function handler(medplum: MedplumClient, event: BotEvent<SendShifInpatientDischargeOtpInput>) {
    const context = await getKhieWorkflowContext(medplum, event, event.input, dependencies);
    const payerCase = await getPayerCase(medplum, event.input);
    const contacts = await context.client.getPatientContacts(payerCase.khiePatientId);
    if (!contacts.some((contact) => contact.contact_id === event.input.contactId)) {
      throw new Error('The selected contact is not available for the payer case');
    }
    const result = await context.client.sendDischargeOtp({
      consent_token: getConsentToken(payerCase.claim),
      beneficiary_cr_id: payerCase.khiePatientId,
      beneficiary_contact_id: event.input.contactId,
      otp_type: 'discharge',
    });
    await setPayerCaseStatus(medplum, payerCase.task, 'in-progress', 'discharge-otp-sent', 'Discharge OTP sent');
    return result;
  };
}

export const handler = createSendShifInpatientDischargeOtpHandler();