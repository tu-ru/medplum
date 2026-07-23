// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { BotEvent, MedplumClient } from '@medplum/core';
import { getKhieWorkflowContext } from './context';
import { getConsentToken, getPayerCase, setPayerCaseStatus } from './payer-case';
import type { KhieWorkflowDependencies, PreviewAndSubmitShifOutpatientFfsClaimInput } from './types';

export function createPreviewAndSubmitShifOutpatientFfsClaimHandler(dependencies: KhieWorkflowDependencies = {}) {
  return async function handler(medplum: MedplumClient, event: BotEvent<PreviewAndSubmitShifOutpatientFfsClaimInput>) {
    const context = await getKhieWorkflowContext(medplum, event, event.input, dependencies);
    const payerCase = await getPayerCase(medplum, event.input);
    if (payerCase.task.businessStatus?.coding?.[0]?.code !== 'billing-lines-added') {
      throw new Error('SHIF outpatient FFS claim submission requires validated billing lines');
    }
    const consentToken = getConsentToken(payerCase.claim);
    const preview = await context.client.previewClaim(consentToken);
    const submission = await context.client.submitClaim({ ...event.input.submission, consent_token: consentToken });
    await medplum.updateResource({ ...payerCase.claim, status: 'active' });
    await setPayerCaseStatus(medplum, payerCase.task, 'completed', 'claim-submitted', 'Claim submitted');
    return { preview, submission };
  };
}

export const handler = createPreviewAndSubmitShifOutpatientFfsClaimHandler();