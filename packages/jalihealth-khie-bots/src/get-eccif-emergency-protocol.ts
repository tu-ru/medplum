// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { BotEvent, MedplumClient } from '@medplum/core';
import { getKhieWorkflowContext } from './context';
import { getEccifCaseInput, getEccifEmergencyCase } from './eccif-case';
import type { GetEccifEmergencyProtocolInput, KhieWorkflowDependencies } from './types';

export function createGetEccifEmergencyProtocolHandler(dependencies: KhieWorkflowDependencies = {}) {
  return async function handler(medplum: MedplumClient, event: BotEvent<GetEccifEmergencyProtocolInput>) {
    const context = await getKhieWorkflowContext(medplum, event, event.input, dependencies);
    const payerCase = await getEccifEmergencyCase(medplum, event.input);
    return context.client.getEmergencyProtocols(getEccifCaseInput(payerCase.task, 'KHIE intervention code'), event.input.active);
  };
}

export const handler = createGetEccifEmergencyProtocolHandler();