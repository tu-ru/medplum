// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import { createReference, getReferenceString, type MedplumClient } from '@medplum/core';
import type { Claim, Task } from '@medplum/fhirtypes';
import { KHIE_CONSENT_TOKEN_SYSTEM, KHIE_PAYER_CASE_STATUS_SYSTEM, type UhcPayerCaseInput } from './types';

export async function getPayerCase(medplum: MedplumClient, input: UhcPayerCaseInput): Promise<{ claim: Claim; task: Task; khiePatientId: string }> {
  const [claim, task] = await Promise.all([
    medplum.readResource('Claim', input.claimId),
    medplum.readResource('Task', input.taskId),
  ]);
  if (getReferenceString(task.focus) !== `Claim/${claim.id}` || getReferenceString(claim.patient) !== input.patient.reference) {
    throw new Error('The payer case does not match the supplied patient and claim');
  }
  const khiePatientId = task.input?.find((item) => item.type.text === 'KHIE patient ID')?.valueString;
  if (!khiePatientId) {
    throw new Error('The payer case does not include a KHIE patient ID');
  }
  return { claim, task, khiePatientId };
}

export function getConsentToken(claim: Claim): string {
  const consentToken = claim.identifier?.find((identifier) => identifier.system === KHIE_CONSENT_TOKEN_SYSTEM)?.value;
  if (!consentToken) {
    throw new Error('The payer case does not have an authorized KHIE consent token');
  }
  return consentToken;
}

export async function setPayerCaseStatus(
  medplum: MedplumClient,
  task: Task,
  status: Task['status'],
  code: string,
  display: string
): Promise<Task> {
  return medplum.updateResource({
    ...task,
    status,
    businessStatus: { coding: [{ system: KHIE_PAYER_CASE_STATUS_SYSTEM, code, display }] },
  });
}

export async function saveConsentToken(medplum: MedplumClient, claim: Claim, consentToken: string): Promise<Claim> {
  return medplum.updateResource({
    ...claim,
    identifier: [
      ...(claim.identifier?.filter((identifier) => identifier.system !== KHIE_CONSENT_TOKEN_SYSTEM) ?? []),
      { system: KHIE_CONSENT_TOKEN_SYSTEM, value: consentToken },
    ],
  });
}

export function claimReference(claim: Claim) {
  return createReference(claim);
}

export function getPayerCaseInput(task: Task, name: string): string {
  const value = task.input?.find((item) => item.type.text === name)?.valueString;
  if (!value) {
    throw new Error(`The payer case does not include ${name}`);
  }
  return value;
}