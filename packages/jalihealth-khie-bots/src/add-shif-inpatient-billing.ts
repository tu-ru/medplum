// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { BotEvent, MedplumClient } from '@medplum/core';
import { getKhieWorkflowContext } from './context';
import { getConsentToken, getPayerCase, getPayerCaseInput, setPayerCaseStatus } from './payer-case';
import type { AddShifInpatientBillingInput, KhieWorkflowDependencies } from './types';

export function createAddShifInpatientBillingHandler(dependencies: KhieWorkflowDependencies = {}) {
  return async function handler(medplum: MedplumClient, event: BotEvent<AddShifInpatientBillingInput>) {
    const context = await getKhieWorkflowContext(medplum, event, event.input, dependencies);
    const payerCase = await getPayerCase(medplum, event.input);
    const paymentMechanism = getPayerCaseInput(payerCase.task, 'KHIE payment mechanism');
    const status = payerCase.task.businessStatus?.coding?.[0]?.code;
    if (paymentMechanism === 'FEE_FOR_SERVICE' && status !== 'preauth-finalized') {
      throw new Error('SHIF inpatient FFS billing requires a finalised preauthorization');
    }
    if (paymentMechanism === 'PER_DIEM' && status !== 'visit-started') {
      throw new Error('SHIF inpatient per-diem billing requires an active visit');
    }
    const result = await context.client.addClaimLines({
      ...event.input.billing,
      consent_token: getConsentToken(payerCase.claim),
      intervention_code: getPayerCaseInput(payerCase.task, 'KHIE intervention code'),
      service_type: 'INPATIENT',
    });
    await setPayerCaseStatus(medplum, payerCase.task, 'in-progress', 'billing-lines-added', 'Billing lines added');
    return result;
  };
}

export const handler = createAddShifInpatientBillingHandler();