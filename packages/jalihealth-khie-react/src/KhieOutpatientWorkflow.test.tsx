// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import { MantineProvider } from '@mantine/core';
import type { Patient, PractitionerRole, Task } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { KhieOutpatientWorkflow } from './KhieOutpatientWorkflow';
import type { KhieWorkflowBotIdentifiers } from './types';

const bots: KhieWorkflowBotIdentifiers = {
  startUhcVisit: 'start-uhc',
  startShifOutpatientFfs: 'start-shif',
  getPatientContacts: 'get-contacts',
  sendUhcOtp: 'send-uhc-otp',
  createUhcVisit: 'create-uhc-visit',
  addUhcBillingLines: 'add-uhc-billing',
  previewAndSubmitUhcClaim: 'submit-uhc-claim',
  sendShifOtp: 'send-shif-otp',
  createShifVisit: 'create-shif-visit',
  authorizeShifPreauth: 'authorize-shif-preauth',
  submitShifPreauth: 'submit-shif-preauth',
  refreshShifPreauth: 'refresh-shif-preauth',
  addShifBilling: 'add-shif-billing',
  previewAndSubmitShifClaim: 'submit-shif-claim',
};

const patient: Patient = { resourceType: 'Patient', id: 'patient-1', name: [{ text: 'Test Patient' }] };
const practitionerRole: PractitionerRole = {
  resourceType: 'PractitionerRole',
  id: 'practitioner-role-1',
  active: true,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KhieOutpatientWorkflow', () => {
  test('starts a UHC case using only FHIR context and identity input', async () => {
    const medplum = new MockClient();
    const task: Task = {
      resourceType: 'Task',
      id: 'task-1',
      status: 'ready',
      intent: 'order',
      businessStatus: { coding: [{ code: 'eligibility-confirmed', display: 'Eligibility confirmed' }] },
    };
    const onCaseCreated = vi.fn();
    const executeBot = vi.spyOn(medplum, 'executeBot').mockResolvedValue({
      taskId: 'task-1',
      claimId: 'claim-1',
      coverageId: 'coverage-1',
      encounter: { resourceType: 'Encounter', id: 'encounter-1', status: 'in-progress', class: { code: 'AMB' } },
    });
    vi.spyOn(medplum, 'readResource').mockResolvedValue(task as never);

    render(
      <MedplumProvider medplum={medplum}>
        <MantineProvider>
          <KhieOutpatientWorkflow patient={patient} practitionerRole={practitionerRole} bots={bots} onCaseCreated={onCaseCreated} />
        </MantineProvider>
      </MedplumProvider>
    );

    fireEvent.change(screen.getByLabelText('Identification number'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check eligibility and start' }));

    await waitFor(() => {
      expect(executeBot).toHaveBeenCalledWith(
        'start-uhc',
        expect.objectContaining({
          patient: { reference: 'Patient/patient-1' },
          practitionerRole: { reference: 'PractitionerRole/practitioner-role-1' },
          identificationNumber: '12345678',
          identificationType: 'national-id',
        })
      );
    });
    expect(onCaseCreated).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', claimId: 'claim-1', workflow: 'uhc' })
    );
    expect(screen.getByText('Eligibility confirmed')).toBeInTheDocument();
  });
});