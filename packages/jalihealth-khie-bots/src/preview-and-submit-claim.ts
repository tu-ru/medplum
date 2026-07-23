// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { BotEvent, MedplumClient } from '@medplum/core';
import { getKhieWorkflowContext } from './context';
import { getConsentToken, getPayerCase, setPayerCaseStatus } from './payer-case';
import type { KhieWorkflowDependencies, PreviewAndSubmitClaimInput } from './types';

export function createPreviewAndSubmitClaimHandler(dependencies: KhieWorkflowDependencies = {}) {
  return async function handler(medplum: MedplumClient, event: BotEvent<PreviewAndSubmitClaimInput>) {
    const context = await getKhieWorkflowContext(medplum, event, event.input, dependencies);
    const payerCase = await getPayerCase(medplum, event.input);
    const consentToken = getConsentToken(payerCase.claim);
    const preview = await context.client.previewClaim(consentToken);
    const submission = await context.client.submitClaim({ consent_token: consentToken });
    await medplum.updateResource({ ...payerCase.claim, status: 'active' });
    await setPayerCaseStatus(medplum, payerCase.task, 'completed', 'claim-submitted', 'Claim submitted');
    return { preview, submission };
  };
}

export const handler = createPreviewAndSubmitClaimHandler();