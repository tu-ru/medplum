// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { Identifier } from '@medplum/fhirtypes';

export type KhieBotIdentifier = string | Identifier;

export type KhieWorkflowBotIdentifiers = {
  startUhcVisit: KhieBotIdentifier;
  startShifOutpatientFfs: KhieBotIdentifier;
  getPatientContacts: KhieBotIdentifier;
  sendUhcOtp: KhieBotIdentifier;
  createUhcVisit: KhieBotIdentifier;
  addUhcBillingLines: KhieBotIdentifier;
  previewAndSubmitUhcClaim: KhieBotIdentifier;
  sendShifOtp: KhieBotIdentifier;
  createShifVisit: KhieBotIdentifier;
  authorizeShifPreauth: KhieBotIdentifier;
  submitShifPreauth: KhieBotIdentifier;
  refreshShifPreauth: KhieBotIdentifier;
  addShifBilling: KhieBotIdentifier;
  previewAndSubmitShifClaim: KhieBotIdentifier;
};

export type KhieInpatientWorkflowBotIdentifiers = {
  startShifInpatient: KhieBotIdentifier;
  createShifInpatientVisit: KhieBotIdentifier;
  authorizeShifInpatientPreauth: KhieBotIdentifier;
  submitShifInpatientPreauth: KhieBotIdentifier;
  refreshShifInpatientPreauth: KhieBotIdentifier;
  addShifInpatientBilling: KhieBotIdentifier;
  switchShifInpatientIntervention: KhieBotIdentifier;
  sendShifInpatientDischargeOtp: KhieBotIdentifier;
  dischargeShifInpatient: KhieBotIdentifier;
};

export type KhieEccifWorkflowBotIdentifiers = {
  createEccifEmergencyClaim: KhieBotIdentifier;
  resendEccifDoctorConsent: KhieBotIdentifier;
  getEccifEmergencyProtocol: KhieBotIdentifier;
  addEccifEmergencyProtocol: KhieBotIdentifier;
  identifyEccifEmergencyPatient: KhieBotIdentifier;
  previewAndSubmitEccifClaim: KhieBotIdentifier;
};

export type KhiePayerCase = {
  taskId: string;
  claimId: string;
  coverageId?: string;
  encounterId?: string;
  workflow: 'uhc' | 'shif';
  preauthPath?: 'same-day' | 'elective';
};

export type KhieInpatientPayerCase = {
  taskId: string;
  claimId: string;
  coverageId?: string;
  encounterId?: string;
  ward?: Location;
  paymentMechanism: 'PER_DIEM' | 'FEE_FOR_SERVICE';
  preauthPath?: 'same-day' | 'elective';
};

export type KhieEccifEmergencyPayerCase = {
  taskId: string;
  claimId: string;
  patient: Patient;
  unidentified: boolean;
};

export type KhiePatientContact = {
  contactId: number;
  maskedContact: string;
  contactType: string;
};