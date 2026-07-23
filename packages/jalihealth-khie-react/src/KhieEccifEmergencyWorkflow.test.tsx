// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import { MantineProvider } from '@mantine/core';
import type { Patient, PractitionerRole, Task } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { KhieEccifEmergencyWorkflow } from './KhieEccifEmergencyWorkflow';
import type { KhieEccifWorkflowBotIdentifiers } from './types';

const bots: KhieEccifWorkflowBotIdentifiers = {
  createEccifEmergencyClaim: 'create-eccif-emergency-claim',
  resendEccifDoctorConsent: 'resend-eccif-doctor-consent',
  getEccifEmergencyProtocol: 'get-eccif-emergency-protocol',
  addEccifEmergencyProtocol: 'add-eccif-emergency-protocol',
  identifyEccifEmergencyPatient: 'identify-eccif-emergency-patient',
  previewAndSubmitEccifClaim: 'preview-and-submit-eccif-claim',
};

const patient: Patient = { resourceType: 'Patient', id: 'patient-1', name: [{ text: 'Test Patient' }] };
const placeholderPatient: Patient = { resourceType: 'Patient', id: 'patient-unknown', name: [{ text: 'Unidentified emergency patient' }] };
const practitionerRole: PractitionerRole = { resourceType: 'PractitionerRole', id: 'practitioner-role-1', active: true };
const task: Task = { resourceType: 'Task', id: 'task-1', status: 'in-progress', intent: 'order' };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KhieEccifEmergencyWorkflow', () => {
  test('creates an unidentified emergency claim without patient identity fields', async () => {
    const executeBot = renderWorkflow();

    fillRequiredClaimFields();
    fireEvent.click(screen.getByRole('button', { name: 'Create emergency claim' }));

    await waitFor(() => {
      expect(executeBot).toHaveBeenCalledWith(
        'create-eccif-emergency-claim',
        expect.objectContaining({
          interventionCode: 'ECCIF-01',
          referenceNumber: 'ER-001',
          practitionerIdentificationNumber: 'DOC-123',
        })
      );
    });
    expect(executeBot.mock.calls[0][1]).not.toHaveProperty('patient');
    expect(executeBot.mock.calls[0][1]).not.toHaveProperty('beneficiaryCrId');
    expect(executeBot.mock.calls[0][1]).not.toHaveProperty('otp');
  });

  test('creates an identified emergency claim with patient, CR ID, and OTP', async () => {
    const executeBot = renderWorkflow(patient);

    fillRequiredClaimFields();
    fireEvent.change(screen.getByLabelText('Beneficiary CR ID'), { target: { value: 'CR-456' } });
    fireEvent.change(screen.getByLabelText('OTP'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create emergency claim' }));

    await waitFor(() => {
      expect(executeBot).toHaveBeenCalledWith(
        'create-eccif-emergency-claim',
        expect.objectContaining({
          patient: { reference: 'Patient/patient-1' },
          beneficiaryCrId: 'CR-456',
          otp: '123456',
        })
      );
    });
  });
});

function renderWorkflow(initialPatient?: Patient) {
  const medplum = new MockClient();
  const executeBot = vi.spyOn(medplum, 'executeBot').mockResolvedValue({
    patient: initialPatient ?? placeholderPatient,
    taskId: 'task-1',
    claimId: 'claim-1',
    unidentified: !initialPatient,
  });
  vi.spyOn(medplum, 'readResource').mockResolvedValue(task as never);

  render(
    <MedplumProvider medplum={medplum}>
      <MantineProvider>
        <KhieEccifEmergencyWorkflow practitionerRole={practitionerRole} bots={bots} patient={initialPatient} />
      </MantineProvider>
    </MedplumProvider>
  );
  return executeBot;
}

function fillRequiredClaimFields(): void {
  fireEvent.change(screen.getByLabelText('ECCIF intervention code'), { target: { value: 'ECCIF-01' } });
  fireEvent.change(screen.getByLabelText('Emergency reference number'), { target: { value: 'ER-001' } });
  fireEvent.change(screen.getByLabelText('Practitioner identification number'), { target: { value: 'DOC-123' } });
}