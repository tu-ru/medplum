// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import { MantineProvider } from '@mantine/core';
import type { Patient, PractitionerRole, Task } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { KhieInpatientWorkflow } from './KhieInpatientWorkflow';
import type { KhieInpatientWorkflowBotIdentifiers } from './types';

const bots: KhieInpatientWorkflowBotIdentifiers = {
  startShifInpatient: 'start-shif-inpatient',
  createShifInpatientVisit: 'create-shif-inpatient-visit',
  authorizeShifInpatientPreauth: 'authorize-shif-inpatient-preauth',
  submitShifInpatientPreauth: 'submit-shif-inpatient-preauth',
  refreshShifInpatientPreauth: 'refresh-shif-inpatient-preauth',
  addShifInpatientBilling: 'add-shif-inpatient-billing',
  switchShifInpatientIntervention: 'switch-shif-inpatient-intervention',
  sendShifInpatientDischargeOtp: 'send-shif-inpatient-discharge-otp',
  dischargeShifInpatient: 'discharge-shif-inpatient',
};

const patient: Patient = { resourceType: 'Patient', id: 'patient-1', name: [{ text: 'Test Patient' }] };
const practitionerRole: PractitionerRole = { resourceType: 'PractitionerRole', id: 'practitioner-role-1', active: true };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KhieInpatientWorkflow', () => {
  test('starts a SHIF per-diem case with the inpatient payment mechanism', async () => {
    const medplum = new MockClient();
    const task: Task = {
      resourceType: 'Task',
      id: 'task-1',
      status: 'ready',
      intent: 'order',
      businessStatus: { coding: [{ code: 'admitted-per-diem', display: 'Admitted per diem' }] },
    };
    const executeBot = vi.spyOn(medplum, 'executeBot').mockResolvedValue({
      taskId: 'task-1',
      claimId: 'claim-1',
      coverageId: 'coverage-1',
      paymentMechanism: 'PER_DIEM',
    });
    vi.spyOn(medplum, 'readResource').mockResolvedValue(task as never);

    render(
      <MedplumProvider medplum={medplum}>
        <MantineProvider>
          <KhieInpatientWorkflow patient={patient} practitionerRole={practitionerRole} bots={bots} />
        </MantineProvider>
      </MedplumProvider>
    );

    fireEvent.change(screen.getByLabelText('Identification number'), { target: { value: '12345678' } });
    fireEvent.change(screen.getByLabelText('SHIF inpatient intervention code'), { target: { value: 'IP-PD-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check eligibility and admit' }));

    await waitFor(() => {
      expect(executeBot).toHaveBeenCalledWith(
        'start-shif-inpatient',
        expect.objectContaining({
          patient: { reference: 'Patient/patient-1' },
          practitionerRole: { reference: 'PractitionerRole/practitioner-role-1' },
          identificationNumber: '12345678',
          identificationType: 'national-id',
          interventionCode: 'IP-PD-01',
          paymentMechanism: 'PER_DIEM',
        })
      );
    });
    expect(screen.getByText('Admitted per diem')).toBeInTheDocument();
  });
});