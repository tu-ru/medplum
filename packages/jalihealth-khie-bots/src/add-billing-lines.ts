// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { BotEvent, MedplumClient } from '@medplum/core';
import { getKhieWorkflowContext } from './context';
import { getConsentToken, getPayerCase, setPayerCaseStatus } from './payer-case';
import type { AddBillingLinesInput, KhieWorkflowDependencies } from './types';

export function createAddBillingLinesHandler(dependencies: KhieWorkflowDependencies = {}) {
  return async function handler(medplum: MedplumClient, event: BotEvent<AddBillingLinesInput>) {
    const context = await getKhieWorkflowContext(medplum, event, event.input, dependencies);
    const payerCase = await getPayerCase(medplum, event.input);
    await context.client.addClaimLines({ consent_token: getConsentToken(payerCase.claim), lines: event.input.lines });
    await setPayerCaseStatus(medplum, payerCase.task, 'in-progress', 'billing-lines-added', 'Billing lines added');
    return { accepted: true };
  };
}

export const handler = createAddBillingLinesHandler();