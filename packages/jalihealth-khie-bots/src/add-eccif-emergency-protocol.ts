// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { BotEvent, MedplumClient } from '@medplum/core';
import { getKhieWorkflowContext } from './context';
import { getEccifConsentToken, getEccifEmergencyCase } from './eccif-case';
import { setPayerCaseStatus } from './payer-case';
import type { AddEccifEmergencyProtocolInput, KhieWorkflowDependencies } from './types';

export function createAddEccifEmergencyProtocolHandler(dependencies: KhieWorkflowDependencies = {}) {
  return async function handler(medplum: MedplumClient, event: BotEvent<AddEccifEmergencyProtocolInput>) {
    const context = await getKhieWorkflowContext(medplum, event, event.input, dependencies);
    const payerCase = await getEccifEmergencyCase(medplum, event.input);
    const result = await context.client.addEmergencyProtocol({
      ...event.input.protocol,
      consent_token: getEccifConsentToken(payerCase.claim),
    });
    await setPayerCaseStatus(medplum, payerCase.task, 'in-progress', 'protocols-added', 'Emergency protocols added');
    return result;
  };
}

export const handler = createAddEccifEmergencyProtocolHandler();