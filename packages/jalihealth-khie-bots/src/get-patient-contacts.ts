// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { BotEvent, MedplumClient } from '@medplum/core';
import { getKhieWorkflowContext } from './context';
import { getPayerCase } from './payer-case';
import type { GetPatientContactsInput, KhieWorkflowDependencies } from './types';

export function createGetPatientContactsHandler(dependencies: KhieWorkflowDependencies = {}) {
  return async function handler(medplum: MedplumClient, event: BotEvent<GetPatientContactsInput>) {
    const context = await getKhieWorkflowContext(medplum, event, event.input, dependencies);
    const { khiePatientId } = await getPayerCase(medplum, event.input);
    const contacts = await context.client.getPatientContacts(khiePatientId);
    return contacts.map(({ contact_id, masked_contact, contact_type }) => ({ contactId: contact_id, maskedContact: masked_contact, contactType: contact_type }));
  };
}

export const handler = createGetPatientContactsHandler();