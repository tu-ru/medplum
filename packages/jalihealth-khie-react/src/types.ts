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

export type KhiePayerCase = {
  taskId: string;
  claimId: string;
  coverageId?: string;
  encounterId?: string;
  workflow: 'uhc' | 'shif';
  preauthPath?: 'same-day' | 'elective';
};

export type KhiePatientContact = {
  contactId: number;
  maskedContact: string;
  contactType: string;
};