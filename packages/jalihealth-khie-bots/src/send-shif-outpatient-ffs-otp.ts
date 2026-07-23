// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { BotEvent, MedplumClient } from '@medplum/core';
import { getKhieWorkflowContext } from './context';
import { getPayerCase, getPayerCaseInput, setPayerCaseStatus } from './payer-case';
import type { KhieWorkflowDependencies, SendShifOutpatientFfsOtpInput } from './types';

export function createSendShifOutpatientFfsOtpHandler(dependencies: KhieWorkflowDependencies = {}) {
  return async function handler(medplum: MedplumClient, event: BotEvent<SendShifOutpatientFfsOtpInput>) {
    const context = await getKhieWorkflowContext(medplum, event, event.input, dependencies);
    const payerCase = await getPayerCase(medplum, event.input);
    const contacts = await context.client.getPatientContacts(payerCase.khiePatientId);
    if (!contacts.some((contact) => contact.contact_id === event.input.contactId)) {
      throw new Error('The selected contact is not available for the payer case');
    }
    const interventionCode = getPayerCaseInput(payerCase.task, 'KHIE intervention code');
    await context.client.sendOtp({
      patient_id: payerCase.khiePatientId,
      intervention_codes: [interventionCode],
      beneficiary_contact_id: event.input.contactId,
    });
    await setPayerCaseStatus(medplum, payerCase.task, 'in-progress', 'otp-sent', 'OTP sent');
    return { sent: true };
  };
}

export const handler = createSendShifOutpatientFfsOtpHandler();