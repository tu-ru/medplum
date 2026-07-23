// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { BotEvent, MedplumClient } from '@medplum/core';
import { getKhieWorkflowContext } from './context';
import { getPayerCase, setPayerCaseStatus } from './payer-case';
import type { KhieWorkflowDependencies, SendOtpInput } from './types';

export function createSendOtpHandler(dependencies: KhieWorkflowDependencies = {}) {
  return async function handler(medplum: MedplumClient, event: BotEvent<SendOtpInput>) {
    const context = await getKhieWorkflowContext(medplum, event, event.input, dependencies);
    const payerCase = await getPayerCase(medplum, event.input);
    const contacts = await context.client.getPatientContacts(payerCase.khiePatientId);
    if (!contacts.some((contact) => contact.contact_id === event.input.contactId)) {
      throw new Error('The selected contact is not available for the payer case');
    }
    await context.client.sendOtp({ patient_id: payerCase.khiePatientId, contact_id: event.input.contactId });
    await setPayerCaseStatus(medplum, payerCase.task, 'in-progress', 'otp-sent', 'OTP sent');
    return { sent: true };
  };
}

export const handler = createSendOtpHandler();