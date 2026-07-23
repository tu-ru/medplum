// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { BotEvent, MedplumClient } from '@medplum/core';
import { getKhieWorkflowContext } from './context';
import { getConsentToken, getPayerCase, getPayerCaseInput, setPayerCaseStatus } from './payer-case';
import type { KhieWorkflowDependencies, RefreshShifInpatientPreauthInput } from './types';

export function createRefreshShifInpatientPreauthHandler(dependencies: KhieWorkflowDependencies = {}) {
  return async function handler(medplum: MedplumClient, event: BotEvent<RefreshShifInpatientPreauthInput>) {
    const context = await getKhieWorkflowContext(medplum, event, event.input, dependencies);
    const payerCase = await getPayerCase(medplum, event.input);
    if (getPayerCaseInput(payerCase.task, 'KHIE payment mechanism') !== 'FEE_FOR_SERVICE') {
      throw new Error('Preauthorization is not available for SHIF inpatient per-diem cases');
    }
    const result = await context.client.getPreauthStatus(getConsentToken(payerCase.claim));
    const status = getPreauthStatus(result);
    await setPayerCaseStatus(
      medplum,
      payerCase.task,
      'in-progress',
      status === 'FINALISED' ? 'preauth-finalized' : 'preauth-pending',
      status === 'FINALISED' ? 'Preauthorization finalised' : 'Preauthorization pending'
    );
    return { status, preauth: result };
  };
}

function getPreauthStatus(result: Record<string, unknown>): string | undefined {
  if (typeof result.status === 'string') {
    return result.status;
  }
  const preauth = result.preauth;
  return typeof preauth === 'object' && preauth !== null && typeof (preauth as Record<string, unknown>).status === 'string'
    ? (preauth as Record<string, string>).status
    : undefined;
}

export const handler = createRefreshShifInpatientPreauthHandler();