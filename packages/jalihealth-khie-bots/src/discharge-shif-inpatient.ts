// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { BotEvent, MedplumClient } from '@medplum/core';
import { getKhieWorkflowContext } from './context';
import { getConsentToken, getPayerCase, setPayerCaseStatus } from './payer-case';
import type { DischargeShifInpatientInput, KhieWorkflowDependencies } from './types';

export function createDischargeShifInpatientHandler(dependencies: KhieWorkflowDependencies = {}) {
  return async function handler(medplum: MedplumClient, event: BotEvent<DischargeShifInpatientInput>) {
    if (!event.input.otp && !event.input.authGuid) {
      throw new Error('An OTP or biometric authorization GUID is required to discharge an inpatient claim');
    }
    if (event.input.dischargeReason === 'DECEASED') {
      if (!event.input.nextOfKinFullName || !event.input.nextOfKinIdNumber || !event.input.nextOfKinIdNumberType || !event.input.contactValue) {
        throw new Error('Next-of-kin details are required when the discharge reason is DECEASED');
      }
    }
    const context = await getKhieWorkflowContext(medplum, event, event.input, dependencies);
    const payerCase = await getPayerCase(medplum, event.input);
    const payerStatus = payerCase.task.businessStatus?.coding?.[0]?.code;
    if (payerStatus !== 'billing-lines-added' && payerStatus !== 'discharge-otp-sent') {
      throw new Error('Inpatient claim discharge requires billing to be completed first');
    }
    const consentToken = getConsentToken(payerCase.claim);
    const preview = await context.client.previewClaim(consentToken);
    const discharge = await context.client.dischargePatient({
      consent_token: consentToken,
      beneficiary_cr_id: payerCase.khiePatientId,
      discharge_date: event.input.dischargeDate,
      discharge_reason: event.input.dischargeReason,
      invoice_number: event.input.invoiceNumber,
      is_alive: event.input.dischargeReason !== 'DECEASED',
      ...(event.input.otp ? { otp: event.input.otp } : {}),
      ...(event.input.authGuid ? { auth_guid: event.input.authGuid } : {}),
      ...(event.input.dischargeReason === 'DECEASED'
        ? {
            next_of_kin_full_name: event.input.nextOfKinFullName,
            next_of_kin_id_number: event.input.nextOfKinIdNumber,
            next_of_kin_id_number_type: event.input.nextOfKinIdNumberType,
            contact_value: event.input.contactValue,
          }
        : {}),
    });
    await medplum.updateResource({ ...payerCase.claim, status: 'active' });
    await setPayerCaseStatus(medplum, payerCase.task, 'completed', 'claim-submitted', 'Inpatient claim discharged and submitted');
    return { preview, discharge };
  };
}

export const handler = createDischargeShifInpatientHandler();