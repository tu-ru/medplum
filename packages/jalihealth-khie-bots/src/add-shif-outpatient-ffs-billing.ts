// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { BotEvent, MedplumClient } from '@medplum/core';
import { getKhieWorkflowContext } from './context';
import { getConsentToken, getPayerCase, getPayerCaseInput, setPayerCaseStatus } from './payer-case';
import type { AddShifOutpatientFfsBillingInput, KhieWorkflowDependencies } from './types';

export function createAddShifOutpatientFfsBillingHandler(dependencies: KhieWorkflowDependencies = {}) {
  return async function handler(medplum: MedplumClient, event: BotEvent<AddShifOutpatientFfsBillingInput>) {
    const context = await getKhieWorkflowContext(medplum, event, event.input, dependencies);
    const payerCase = await getPayerCase(medplum, event.input);
    if (payerCase.task.businessStatus?.coding?.[0]?.code !== 'preauth-finalized') {
      throw new Error('SHIF outpatient FFS billing requires a finalised preauthorization');
    }
    const result = await context.client.addClaimLines({
      ...event.input.billing,
      consent_token: getConsentToken(payerCase.claim),
      intervention_code: getPayerCaseInput(payerCase.task, 'KHIE intervention code'),
      service_type: 'OUTPATIENT',
    });
    await setPayerCaseStatus(medplum, payerCase.task, 'in-progress', 'billing-lines-added', 'Billing lines added');
    return result;
  };
}

export const handler = createAddShifOutpatientFfsBillingHandler();