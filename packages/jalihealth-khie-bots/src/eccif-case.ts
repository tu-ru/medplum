// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import { getReferenceString, type MedplumClient } from '@medplum/core';
import type { Claim, Task } from '@medplum/fhirtypes';
import { KHIE_CONSENT_TOKEN_SYSTEM, type EccifEmergencyPayerCaseInput } from './types';

export async function getEccifEmergencyCase(
  medplum: MedplumClient,
  input: EccifEmergencyPayerCaseInput
): Promise<{ claim: Claim; task: Task }> {
  const [claim, task] = await Promise.all([
    medplum.readResource('Claim', input.claimId),
    medplum.readResource('Task', input.taskId),
  ]);
  if (getReferenceString(task.focus) !== `Claim/${claim.id}` || getReferenceString(claim.patient) !== input.patient.reference) {
    throw new Error('The ECCIF emergency case does not match the supplied patient and claim');
  }
  return { claim, task };
}

export function getEccifConsentToken(claim: Claim): string {
  const consentToken = claim.identifier?.find((identifier) => identifier.system === KHIE_CONSENT_TOKEN_SYSTEM)?.value;
  if (!consentToken) {
    throw new Error('The ECCIF emergency case does not have an authorized KHIE consent token');
  }
  return consentToken;
}

export function getEccifCaseInput(task: Task, name: string): string {
  const value = task.input?.find((item) => item.type.text === name)?.valueString;
  if (!value) {
    throw new Error(`The ECCIF emergency case does not include ${name}`);
  }
  return value;
}