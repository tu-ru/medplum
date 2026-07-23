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

export type KhieInpatientPaymentMechanism = 'PER_DIEM' | 'FEE_FOR_SERVICE';

export type StartShifInpatientInput = KhieWorkflowInput & {
  identificationNumber: string;
  identificationType: string;
  interventionCode: string;
  paymentMechanism?: KhieInpatientPaymentMechanism;
};

export type StartShifInpatientResult = StartUhcVisitResult & {
  paymentMechanism: KhieInpatientPaymentMechanism;
  preauthPath?: 'same-day' | 'elective';
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

export type EccifEmergencyDetails = {
  modeOfArrival: 'AMBULANCE' | 'WALK-IN' | 'OTHER';
  broughtBy: 'RELATIVE' | 'UNKNOWN' | 'SAMARITAN' | 'PARAMEDICS';
  referenceNumber: string;
  practitionerIdentificationNumber: string;
  practitionerIdentificationType: string;
  regulationBody: 'KMPDC' | 'COC' | 'NCK';
  notes?: string;
};

export type CreateEccifEmergencyClaimInput = Omit<KhieWorkflowInput, 'patient'> & EccifEmergencyDetails & {
  patient?: Reference<Patient>;
  interventionCode: string;
  beneficiaryCrId?: string;
  otp?: string;
};

export type CreateEccifEmergencyClaimResult = {
  patient: Patient;
  claimId: string;
  taskId: string;
  consentTokenStored: true;
  unidentified: boolean;
};

export type EccifEmergencyResult = CreateEccifEmergencyClaimResult;

export type EccifEmergencyPayerCaseInput = UhcPayerCaseInput;

export type ResendEccifDoctorConsentInput = EccifEmergencyPayerCaseInput & {
  doctorIdentificationNumber: string;
};

export type GetEccifEmergencyProtocolInput = EccifEmergencyPayerCaseInput & {
  active?: boolean;
};

export type AddEccifEmergencyProtocolInput = EccifEmergencyPayerCaseInput & {
  protocol: Record<string, unknown>;
};

export type AddEccifProtocolInput = AddEccifEmergencyProtocolInput;

export type IdentifyEccifEmergencyPatientInput = Omit<EccifEmergencyPayerCaseInput, 'patient'> & {
  patient: Reference<Patient>;
  beneficiaryCrId: string;
  otp: string;
};

export type IdentifyEccifPatientInput = IdentifyEccifEmergencyPatientInput;

export type PreviewAndSubmitEccifClaimInput = EccifEmergencyPayerCaseInput & {
  dischargeReason: 'RECOVERED' | 'REFERRED' | 'DECEASED' | 'ABSCONDED' | 'OTHER';
  invoiceNumber: string;
  reasonForUnknownPatient?: 'SHA_UNREGISTERED' | 'DECEASED';
};

export type SubmitEccifClaimInput = PreviewAndSubmitEccifClaimInput;

export type ShifOutpatientFfsPayerCaseInput = UhcPayerCaseInput;

export type ShifInpatientPayerCaseInput = UhcPayerCaseInput;

export type CreateShifInpatientVisitInput = ShifInpatientPayerCaseInput & {
  otp?: string;
  authGuid?: string;
};

export type AuthorizeShifInpatientPreauthInput = ShifInpatientPayerCaseInput & {
  authorization: Record<string, unknown>;
};

export type SubmitShifInpatientPreauthInput = ShifInpatientPayerCaseInput & {
  preauth: Record<string, unknown>;
};

export type RefreshShifInpatientPreauthInput = ShifInpatientPayerCaseInput;

export type AddShifInpatientBillingInput = ShifInpatientPayerCaseInput & {
  billing: Record<string, unknown>;
};

export type SwitchShifInpatientInterventionInput = Omit<ShifInpatientPayerCaseInput, 'selectedLocation'> & {
  encounter: Reference<Encounter>;
  selectedLocation: Reference<Location>;
  interventionCode: string;
};

export type SendShifInpatientDischargeOtpInput = ShifInpatientPayerCaseInput & {
  contactId: number;
};

export type SendDischargeOtpInput = SendShifInpatientDischargeOtpInput;

export type DischargeShifInpatientInput = ShifInpatientPayerCaseInput & {
  otp?: string;
  authGuid?: string;
  dischargeDate: string;
  dischargeReason: string;
  invoiceNumber: string;
  nextOfKinFullName?: string;
  nextOfKinIdNumber?: string;
  nextOfKinIdNumberType?: string;
  contactValue?: string;
};

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
