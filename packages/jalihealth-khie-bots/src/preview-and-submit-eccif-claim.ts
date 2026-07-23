// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { BotEvent, MedplumClient } from '@medplum/core';
import { getKhieWorkflowContext } from './context';
import { getEccifCaseInput, getEccifConsentToken, getEccifEmergencyCase } from './eccif-case';
import { setPayerCaseStatus } from './payer-case';
import type { KhieWorkflowDependencies, PreviewAndSubmitEccifClaimInput } from './types';

export function createPreviewAndSubmitEccifClaimHandler(dependencies: KhieWorkflowDependencies = {}) {
  return async function handler(medplum: MedplumClient, event: BotEvent<PreviewAndSubmitEccifClaimInput>) {
    const context = await getKhieWorkflowContext(medplum, event, event.input, dependencies);
    const payerCase = await getEccifEmergencyCase(medplum, event.input);
    const unidentified = getEccifCaseInput(payerCase.task, 'KHIE ECCIF patient status') === 'unidentified';
    if (unidentified && !event.input.reasonForUnknownPatient) {
      throw new Error('An unidentified ECCIF emergency claim requires a reason for the unknown patient');
    }
    const consentToken = getEccifConsentToken(payerCase.claim);
    const preview = await context.client.previewClaim(consentToken);
    const submission = await context.client.submitClaim({
      consent_token: consentToken,
      discharge_reason: event.input.dischargeReason,
      invoice_number: event.input.invoiceNumber,
      ...(unidentified ? { reason_for_unknown_patient: event.input.reasonForUnknownPatient } : {}),
    });
    await medplum.updateResource({ ...payerCase.claim, status: 'active' });
    await setPayerCaseStatus(medplum, payerCase.task, 'completed', 'claim-submitted', 'ECCIF emergency claim submitted');
    return { preview, submission };
  };
}

export const handler = createPreviewAndSubmitEccifClaimHandler();