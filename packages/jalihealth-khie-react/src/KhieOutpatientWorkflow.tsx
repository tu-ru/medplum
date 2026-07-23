// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import { Alert, Badge, Button, Divider, Group, Paper, SegmentedControl, Select, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { createReference, normalizeErrorString } from '@medplum/core';
import type { Encounter, Location, Patient, PractitionerRole, Task } from '@medplum/fhirtypes';
import { ResourceInput, useMedplum } from '@medplum/react';
import { IconAlertCircle, IconArrowRight, IconCheck, IconRefresh, IconSend } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useState } from 'react';
import type { KhiePatientContact, KhiePayerCase, KhieWorkflowBotIdentifiers } from './types';

export interface KhieOutpatientWorkflowProps {
  readonly patient: Patient;
  readonly practitionerRole: PractitionerRole;
  readonly bots: KhieWorkflowBotIdentifiers;
  readonly encounter?: Encounter;
  readonly initialLocation?: Location;
  readonly onCaseCreated?: (payerCase: KhiePayerCase) => void;
}

type Workflow = 'uhc' | 'shif';

export function KhieOutpatientWorkflow(props: KhieOutpatientWorkflowProps): JSX.Element {
  const medplum = useMedplum();
  const [workflow, setWorkflow] = useState<Workflow>('uhc');
  const [identificationNumber, setIdentificationNumber] = useState('');
  const [identificationType, setIdentificationType] = useState('national-id');
  const [interventionCode, setInterventionCode] = useState('');
  const [location, setLocation] = useState<Location | undefined>(props.initialLocation);
  const [payerCase, setPayerCase] = useState<KhiePayerCase>();
  const [contacts, setContacts] = useState<KhiePatientContact[]>([]);
  const [selectedContact, setSelectedContact] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [authGuid, setAuthGuid] = useState('');
  const [preauth, setPreauth] = useState('{}');
  const [billing, setBilling] = useState(workflow === 'uhc' ? '[]' : '{}');
  const [preauthStatus, setPreauthStatus] = useState<string>();
  const [busyAction, setBusyAction] = useState<string>();
  const [error, setError] = useState<string>();
  const [task, setTask] = useState<Task>();
  const [result, setResult] = useState<unknown>();

  const patientReference = createReference(props.patient);
  const practitionerRoleReference = createReference(props.practitionerRole);

  function getCaseInput(): Record<string, unknown> {
    if (!payerCase) {
      throw new Error('Start a payer workflow before continuing');
    }
    return {
      patient: patientReference,
      practitionerRole: practitionerRoleReference,
      taskId: payerCase.taskId,
      claimId: payerCase.claimId,
      ...(location ? { selectedLocation: createReference(location) } : {}),
    };
  }

  async function runAction<T>(name: string, callback: () => Promise<T>): Promise<T | undefined> {
    setBusyAction(name);
    setError(undefined);
    try {
      const actionResult = await callback();
      setResult(actionResult);
      if (payerCase) {
        setTask(await medplum.readResource('Task', payerCase.taskId));
      }
      return actionResult;
    } catch (err) {
      setError(normalizeErrorString(err));
      return undefined;
    } finally {
      setBusyAction(undefined);
    }
  }

  async function startWorkflow(): Promise<void> {
    if (!identificationNumber.trim()) {
      setError('Enter the patient identification number.');
      return;
    }
    if (workflow === 'shif' && !interventionCode.trim()) {
      setError('Enter the SHIF outpatient intervention code.');
      return;
    }
    const actionResult = await runAction('start', async () => {
      const input = {
        patient: patientReference,
        practitionerRole: practitionerRoleReference,
        identificationNumber: identificationNumber.trim(),
        identificationType,
        ...(props.encounter ? { encounter: createReference(props.encounter) } : {}),
        ...(location ? { selectedLocation: createReference(location) } : {}),
        ...(workflow === 'shif' ? { interventionCode: interventionCode.trim() } : {}),
      };
      return medplum.executeBot(
        workflow === 'uhc' ? props.bots.startUhcVisit : props.bots.startShifOutpatientFfs,
        input
      ) as Promise<{ taskId: string; claimId: string; coverageId: string; encounter: Encounter; preauthPath?: 'same-day' | 'elective' }>;
    });
    if (!actionResult) {
      return;
    }
    const nextCase: KhiePayerCase = {
      taskId: actionResult.taskId,
      claimId: actionResult.claimId,
      coverageId: actionResult.coverageId,
      encounterId: actionResult.encounter.id,
      workflow,
      preauthPath: actionResult.preauthPath,
    };
    setPayerCase(nextCase);
    setTask(await medplum.readResource('Task', actionResult.taskId));
    props.onCaseCreated?.(nextCase);
  }

  async function loadContacts(): Promise<void> {
    const actionResult = await runAction('contacts', () =>
      medplum.executeBot(props.bots.getPatientContacts, getCaseInput()) as Promise<KhiePatientContact[]>
    );
    if (actionResult) {
      setContacts(actionResult);
      setSelectedContact(actionResult[0] ? String(actionResult[0].contactId) : null);
    }
  }

  async function sendOtp(): Promise<void> {
    if (!selectedContact) {
      setError('Choose a verified patient contact first.');
      return;
    }
    await runAction('send-otp', () =>
      medplum.executeBot(workflow === 'uhc' ? props.bots.sendUhcOtp : props.bots.sendShifOtp, {
        ...getCaseInput(),
        contactId: Number(selectedContact),
      })
    );
  }

  async function createVisit(): Promise<void> {
    if (!otp.trim() && !authGuid.trim()) {
      setError('Enter the one-time passcode or biometric authorization GUID.');
      return;
    }
    await runAction('create-visit', () =>
      medplum.executeBot(workflow === 'uhc' ? props.bots.createUhcVisit : props.bots.createShifVisit, {
        ...getCaseInput(),
        ...(otp.trim() ? { otp: otp.trim() } : {}),
        ...(authGuid.trim() ? { authGuid: authGuid.trim() } : {}),
      })
    );
  }

  async function submitPreauth(): Promise<void> {
    const payload = parseJson(preauth, 'preauthorization');
    if (!payload) {
      return;
    }
    const bot = payerCase?.preauthPath === 'elective' ? props.bots.authorizeShifPreauth : props.bots.submitShifPreauth;
    const property = payerCase?.preauthPath === 'elective' ? 'authorization' : 'preauth';
    await runAction('preauth', () => medplum.executeBot(bot, { ...getCaseInput(), [property]: payload }));
  }

  async function refreshPreauth(): Promise<void> {
    const actionResult = await runAction('refresh-preauth', () =>
      medplum.executeBot(props.bots.refreshShifPreauth, getCaseInput()) as Promise<{ status?: string }>
    );
    if (actionResult?.status) {
      setPreauthStatus(actionResult.status);
    }
  }

  async function addBilling(): Promise<void> {
    const payload = parseJson(billing, workflow === 'uhc' ? 'billing lines' : 'billing payload');
    if (!payload || (workflow === 'uhc' && !Array.isArray(payload))) {
      if (payload && !Array.isArray(payload)) {
        setError('UHC billing lines must be a JSON array.');
      }
      return;
    }
    await runAction('billing', () =>
      medplum.executeBot(workflow === 'uhc' ? props.bots.addUhcBillingLines : props.bots.addShifBilling, {
        ...getCaseInput(),
        ...(workflow === 'uhc' ? { lines: payload } : { billing: payload }),
      })
    );
  }

  async function submitClaim(): Promise<void> {
    await runAction('submit-claim', () =>
      medplum.executeBot(
        workflow === 'uhc' ? props.bots.previewAndSubmitUhcClaim : props.bots.previewAndSubmitShifClaim,
        workflow === 'uhc' ? getCaseInput() : { ...getCaseInput(), submission: {} }
      )
    );
  }

  function parseJson(value: string, label: string): Record<string, unknown> | unknown[] | undefined {
    try {
      return JSON.parse(value) as Record<string, unknown> | unknown[];
    } catch {
      setError(`Enter valid JSON for ${label}.`);
      return undefined;
    }
  }

  const status = task?.businessStatus?.coding?.[0]?.display ?? task?.businessStatus?.coding?.[0]?.code;
  const isShif = payerCase?.workflow === 'shif';

  return (
    <Stack gap="md" data-testid="khie-outpatient-workflow">
      <Paper withBorder p="md" radius="sm">
        <Stack gap="md">
          <Group justify="space-between" align="center">
            <div>
              <Text fw={700}>KHIE outpatient payer workflow</Text>
              <Text size="sm" c="dimmed">Eligibility, consent, preauthorization, billing, and submission.</Text>
            </div>
            {status && <Badge color={task?.status === 'completed' ? 'green' : 'blue'}>{status}</Badge>}
          </Group>
          {!payerCase && (
            <>
              <SegmentedControl
                value={workflow}
                onChange={(value) => {
                  const nextWorkflow = value as Workflow;
                  setWorkflow(nextWorkflow);
                  setBilling(nextWorkflow === 'uhc' ? '[]' : '{}');
                }}
                data={[
                  { value: 'uhc', label: 'UHC capitation' },
                  { value: 'shif', label: 'SHIF fee-for-service' },
                ]}
              />
              <Group grow align="start">
                <TextInput label="Identification number" value={identificationNumber} onChange={(event) => setIdentificationNumber(event.currentTarget.value)} required />
                <Select label="Identification type" value={identificationType} onChange={(value) => setIdentificationType(value ?? 'national-id')} data={['national-id', 'passport', 'alien-id']} />
              </Group>
              {workflow === 'shif' && <TextInput label="SHIF intervention code" value={interventionCode} onChange={(event) => setInterventionCode(event.currentTarget.value)} required />}
              <ResourceInput resourceType="Location" name="working-location" label="Working location" defaultValue={location} onChange={setLocation} />
              <Group justify="flex-end"><Button onClick={startWorkflow} loading={busyAction === 'start'} rightSection={<IconArrowRight size={16} />}>Check eligibility and start</Button></Group>
            </>
          )}
        </Stack>
      </Paper>

      {error && <Alert color="red" icon={<IconAlertCircle size={16} />} title="Workflow action failed">{error}</Alert>}

      {payerCase && (
        <Paper withBorder p="md" radius="sm">
          <Stack gap="md">
            <Group gap="xs"><Badge variant="light">{payerCase.workflow === 'uhc' ? 'UHC capitation' : 'SHIF FFS'}</Badge>{payerCase.preauthPath && <Badge variant="outline">{payerCase.preauthPath} preauthorization</Badge>}</Group>
            <Text size="sm" c="dimmed">Case {payerCase.taskId}</Text>
            <Group grow align="end">
              <Select label="Verified patient contact" placeholder="Load contacts" value={selectedContact} onChange={setSelectedContact} data={contacts.map((contact) => ({ value: String(contact.contactId), label: `${contact.maskedContact} (${contact.contactType})` }))} />
              <Button variant="default" onClick={loadContacts} loading={busyAction === 'contacts'}>Load contacts</Button>
              <Button onClick={sendOtp} loading={busyAction === 'send-otp'} disabled={!selectedContact}>Send OTP</Button>
            </Group>
            <Group grow align="end">
              <TextInput label="One-time passcode" value={otp} onChange={(event) => setOtp(event.currentTarget.value)} />
              <TextInput label="Biometric authorization GUID" value={authGuid} onChange={(event) => setAuthGuid(event.currentTarget.value)} />
              <Button onClick={createVisit} loading={busyAction === 'create-visit'}>Create visit</Button>
            </Group>
            {isShif && (
              <>
                <Divider />
                <Textarea label={payerCase.preauthPath === 'elective' ? 'Pre-visit authorization JSON' : 'Preauthorization JSON'} autosize minRows={4} value={preauth} onChange={(event) => setPreauth(event.currentTarget.value)} />
                <Group justify="space-between">
                  <Text size="sm" c={preauthStatus === 'FINALISED' ? 'green' : 'dimmed'}>{preauthStatus ? `KHIE preauthorization: ${preauthStatus}` : 'Preauthorization status has not been refreshed.'}</Text>
                  <Group>
                    <Button variant="default" onClick={refreshPreauth} loading={busyAction === 'refresh-preauth'} leftSection={<IconRefresh size={16} />}>Refresh status</Button>
                    <Button onClick={submitPreauth} loading={busyAction === 'preauth'}>{payerCase.preauthPath === 'elective' ? 'Authorize pre-visit' : 'Submit preauthorization'}</Button>
                  </Group>
                </Group>
              </>
            )}
            <Divider />
            <Textarea label={isShif ? 'Billing JSON' : 'Billing lines JSON'} autosize minRows={4} value={billing} onChange={(event) => setBilling(event.currentTarget.value)} />
            <Group justify="flex-end">
              <Button variant="default" onClick={addBilling} loading={busyAction === 'billing'}>Add billing</Button>
              <Button color="teal" onClick={submitClaim} loading={busyAction === 'submit-claim'} rightSection={<IconSend size={16} />}>Preview and submit claim</Button>
            </Group>
            {result !== undefined && <Alert color="green" icon={<IconCheck size={16} />} title="Latest workflow response"><Text component="pre" size="xs" style={{ overflowX: 'auto', whiteSpace: 'pre-wrap' }}>{JSON.stringify(result, null, 2)}</Text></Alert>}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}