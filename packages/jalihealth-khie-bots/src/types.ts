// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { Encounter, Location, Patient, PractitionerRole, Reference } from '@medplum/fhirtypes';
import type { KhieClient } from '@medplum/jalihealth-khie-core';

export const KHIE_PAYER_CASE_STATUS_SYSTEM = 'https://jalihealth.ke/fhir/CodeSystem/khie-payer-case-status';
export const KHIE_CONSENT_TOKEN_SYSTEM = 'https://jalihealth.ke/fhir/Identifier/khie-consent-token';
export const KHIE_COVERAGE_SYSTEM = 'https://jalihealth.ke/fhir/Identifier/khie-coverage';

export type KhieWorkflowInput = {
  patient: Reference<Patient>;
  practitionerRole: Reference<PractitionerRole>;
  encounter?: Reference<Encounter>;
  patientLocation?: Reference<Location>;
  selectedLocation?: Reference<Location>;
};

export type StartUhcVisitInput = KhieWorkflowInput & {
  identificationNumber: string;
  identificationType: string;
};

export type StartUhcVisitResult = {
  encounter: Encounter;
  taskId: string;
  claimId: string;
  coverageId: string;
  khiePatientId: string;
};

export type UhcPayerCaseInput = {
  patient: Reference<Patient>;
  practitionerRole: Reference<PractitionerRole>;
  taskId: string;
  claimId: string;
  patientLocation?: Reference<Location>;
  selectedLocation?: Reference<Location>;
};

export type StartShifOutpatientFfsInput = KhieWorkflowInput & {
  identificationNumber: string;
  identificationType: string;
  interventionCode: string;
};

export type StartShifOutpatientFfsResult = StartUhcVisitResult & {
  preauthPath: 'same-day' | 'elective';
};

export type GetPatientContactsInput = UhcPayerCaseInput;

export type SendOtpInput = UhcPayerCaseInput & {
  contactId: number;
};

export type CreateVisitInput = UhcPayerCaseInput & {
  otp?: string;
  authGuid?: string;
};

export type AddBillingLinesInput = UhcPayerCaseInput & {
  lines: Record<string, unknown>[];
};

export type PreviewAndSubmitClaimInput = UhcPayerCaseInput;

export type ShifOutpatientFfsPayerCaseInput = UhcPayerCaseInput;

export type SendShifOutpatientFfsOtpInput = ShifOutpatientFfsPayerCaseInput & {
  contactId: number;
};

export type CreateShifOutpatientFfsVisitInput = ShifOutpatientFfsPayerCaseInput & {
  otp?: string;
  authGuid?: string;
};

export type AuthorizeShifOutpatientFfsPreauthInput = ShifOutpatientFfsPayerCaseInput & {
  authorization: Record<string, unknown>;
};

export type SubmitShifOutpatientFfsPreauthInput = ShifOutpatientFfsPayerCaseInput & {
  preauth: Record<string, unknown>;
};

export type RefreshShifOutpatientFfsPreauthInput = ShifOutpatientFfsPayerCaseInput;

export type AddShifOutpatientFfsBillingInput = ShifOutpatientFfsPayerCaseInput & {
  billing: Record<string, unknown>;
};

export type PreviewAndSubmitShifOutpatientFfsClaimInput = ShifOutpatientFfsPayerCaseInput & {
  submission: Record<string, unknown>;
};

export type KhieWorkflowDependencies = {
  createClient?: (config: ConstructorParameters<typeof KhieClient>[0]) => KhieClient;
};
