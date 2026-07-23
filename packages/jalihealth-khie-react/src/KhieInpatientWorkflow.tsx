// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import { Alert, Badge, Button, Divider, Group, Paper, SegmentedControl, Select, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { createReference, normalizeErrorString } from '@medplum/core';
import type { Encounter, Location, Patient, PractitionerRole, Task } from '@medplum/fhirtypes';
import { ResourceInput, useMedplum } from '@medplum/react';
import { IconAlertCircle, IconArrowRight, IconCheck, IconRefresh, IconRepeat, IconSend } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useState } from 'react';
import type { KhieInpatientPayerCase, KhieInpatientWorkflowBotIdentifiers } from './types';

export interface KhieInpatientWorkflowProps {
  readonly patient: Patient;
  readonly practitionerRole: PractitionerRole;
  readonly bots: KhieInpatientWorkflowBotIdentifiers;
  readonly encounter?: Encounter;
  readonly initialLocation?: Location;
  readonly onCaseCreated?: (payerCase: KhieInpatientPayerCase) => void;
}

type AdmissionPath = 'per-diem' | 'ffs';

const INPATIENT_LOCATION_SEARCH = { 'physical-type': 'wa,bd' };

export function KhieInpatientWorkflow(props: KhieInpatientWorkflowProps): JSX.Element {
  const medplum = useMedplum();
  const [admissionPath, setAdmissionPath] = useState<AdmissionPath>('per-diem');
  const [identificationNumber, setIdentificationNumber] = useState('');
  const [identificationType, setIdentificationType] = useState('national-id');
  const [interventionCode, setInterventionCode] = useState('');
  const [location, setLocation] = useState<Location | undefined>(props.initialLocation);
  const [payerCase, setPayerCase] = useState<KhieInpatientPayerCase>();
  const [task, setTask] = useState<Task>();
  const [admissionOtp, setAdmissionOtp] = useState('');
  const [admissionAuthGuid, setAdmissionAuthGuid] = useState('');
  const [preauth, setPreauth] = useState('{}');
  const [preauthStatus, setPreauthStatus] = useState<string>();
  const [billing, setBilling] = useState('{}');
  const [transferLocation, setTransferLocation] = useState<Location>();
  const [transferInterventionCode, setTransferInterventionCode] = useState('');
  const [dischargeContactId, setDischargeContactId] = useState('');
  const [dischargeOtp, setDischargeOtp] = useState('');
  const [dischargeAuthGuid, setDischargeAuthGuid] = useState('');
  const [dischargeDate, setDischargeDate] = useState(new Date().toISOString().slice(0, 10));
  const [dischargeReason, setDischargeReason] = useState('RECOVERED');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [nextOfKinFullName, setNextOfKinFullName] = useState('');
  const [nextOfKinIdNumber, setNextOfKinIdNumber] = useState('');
  const [nextOfKinIdNumberType, setNextOfKinIdNumberType] = useState('national-id');
  const [nextOfKinContactValue, setNextOfKinContactValue] = useState('');
  const [busyAction, setBusyAction] = useState<string>();
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<unknown>();

  const patientReference = createReference(props.patient);
  const practitionerRoleReference = createReference(props.practitionerRole);
  const requiresPreauth = payerCase?.paymentMechanism === 'FEE_FOR_SERVICE';
  const isDeceased = dischargeReason === 'DECEASED';

  function getCaseInput(): Record<string, unknown> {
    if (!payerCase) {
      throw new Error('Start an inpatient payer workflow before continuing');
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
    if (!identificationNumber.trim() || !interventionCode.trim()) {
      setError('Enter the patient identification number and SHIF inpatient intervention code.');
      return;
    }
    const paymentMechanism = admissionPath === 'per-diem' ? 'PER_DIEM' : 'FEE_FOR_SERVICE';
    const actionResult = await runAction('start', () =>
      medplum.executeBot(props.bots.startShifInpatient, {
        patient: patientReference,
        practitionerRole: practitionerRoleReference,
        identificationNumber: identificationNumber.trim(),
        identificationType,
        interventionCode: interventionCode.trim(),
        paymentMechanism,
        ...(props.encounter ? { encounter: createReference(props.encounter) } : {}),
        ...(location ? { selectedLocation: createReference(location) } : {}),
      }) as Promise<KhieInpatientPayerCase & { encounter?: Encounter }>
    );
    if (!actionResult) {
      return;
    }
    const nextCase: KhieInpatientPayerCase = {
      taskId: actionResult.taskId,
      claimId: actionResult.claimId,
      coverageId: actionResult.coverageId,
      encounterId: actionResult.encounterId ?? actionResult.encounter?.id,
      ward: location,
      paymentMechanism: actionResult.paymentMechanism,
      preauthPath: actionResult.preauthPath,
    };
    setPayerCase(nextCase);
    setTask(await medplum.readResource('Task', actionResult.taskId));
    props.onCaseCreated?.(nextCase);
  }

  async function submitPreauth(): Promise<void> {
    const payload = parseObject(preauth, 'preauthorization');
    if (!payload || !payerCase) {
      return;
    }
    const bot = payerCase.preauthPath === 'elective' ? props.bots.authorizeShifInpatientPreauth : props.bots.submitShifInpatientPreauth;
    const property = payerCase.preauthPath === 'elective' ? 'authorization' : 'preauth';
    await runAction('preauth', () => medplum.executeBot(bot, { ...getCaseInput(), [property]: payload }));
  }

  async function createVisit(): Promise<void> {
    if (!admissionOtp.trim() && !admissionAuthGuid.trim()) {
      setError('Enter the admission OTP or biometric authorization GUID.');
      return;
    }
    await runAction('create-visit', () =>
      medplum.executeBot(props.bots.createShifInpatientVisit, {
        ...getCaseInput(),
        ...(admissionOtp.trim() ? { otp: admissionOtp.trim() } : {}),
        ...(admissionAuthGuid.trim() ? { authGuid: admissionAuthGuid.trim() } : {}),
      })
    );
  }

  async function refreshPreauth(): Promise<void> {
    const actionResult = await runAction('refresh-preauth', () =>
      medplum.executeBot(props.bots.refreshShifInpatientPreauth, getCaseInput()) as Promise<{ status?: string }>
    );
    if (actionResult?.status) {
      setPreauthStatus(actionResult.status);
    }
  }

  async function addBilling(): Promise<void> {
    const payload = parseObject(billing, 'billing');
    if (!payload) {
      return;
    }
    await runAction('billing', () => medplum.executeBot(props.bots.addShifInpatientBilling, { ...getCaseInput(), billing: payload }));
  }

  async function switchWard(): Promise<void> {
    if (!payerCase?.encounterId || !transferLocation || !transferInterventionCode.trim()) {
      setError('Choose a destination ward and intervention code.');
      return;
    }
    const actionResult = await runAction('switch-intervention', () =>
      medplum.executeBot(props.bots.switchShifInpatientIntervention, {
        ...getCaseInput(),
        encounter: { reference: `Encounter/${payerCase.encounterId}` },
        selectedLocation: createReference(transferLocation),
        interventionCode: transferInterventionCode.trim(),
      })
    );
    if (actionResult) {
      setLocation(transferLocation);
      setPayerCase({ ...payerCase, ward: transferLocation });
    }
  }

  async function sendDischargeOtp(): Promise<void> {
    const contactId = Number(dischargeContactId);
    if (!Number.isInteger(contactId) || contactId <= 0) {
      setError('Enter a valid verified contact ID before sending a discharge OTP.');
      return;
    }
    await runAction('send-discharge-otp', () => medplum.executeBot(props.bots.sendShifInpatientDischargeOtp, { ...getCaseInput(), contactId }));
  }

  async function discharge(): Promise<void> {
    if (!dischargeDate || !invoiceNumber.trim() || (!dischargeOtp.trim() && !dischargeAuthGuid.trim())) {
      setError('Enter the discharge date, invoice number, and OTP or biometric authorization GUID.');
      return;
    }
    if (isDeceased && (!nextOfKinFullName.trim() || !nextOfKinIdNumber.trim() || !nextOfKinContactValue.trim())) {
      setError('Next-of-kin name, identification number, and contact are required for a deceased patient.');
      return;
    }
    await runAction('discharge', () =>
      medplum.executeBot(props.bots.dischargeShifInpatient, {
        ...getCaseInput(),
        ...(dischargeOtp.trim() ? { otp: dischargeOtp.trim() } : {}),
        ...(dischargeAuthGuid.trim() ? { authGuid: dischargeAuthGuid.trim() } : {}),
        dischargeDate,
        dischargeReason,
        invoiceNumber: invoiceNumber.trim(),
        ...(isDeceased
          ? {
              nextOfKinFullName: nextOfKinFullName.trim(),
              nextOfKinIdNumber: nextOfKinIdNumber.trim(),
              nextOfKinIdNumberType,
              contactValue: nextOfKinContactValue.trim(),
            }
          : {}),
      })
    );
  }

  function parseObject(value: string, label: string): Record<string, unknown> | undefined {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new Error('Expected an object');
      }
      return parsed as Record<string, unknown>;
    } catch {
      setError(`Enter valid JSON for ${label}.`);
      return undefined;
    }
  }

  const status = task?.businessStatus?.coding?.[0]?.display ?? task?.businessStatus?.coding?.[0]?.code;

  return (
    <Stack gap="md" data-testid="khie-inpatient-workflow">
      <Paper withBorder p="md" radius="sm">
        <Stack gap="md">
          <Group justify="space-between" align="center">
            <div>
              <Text fw={700}>KHIE inpatient payer workflow</Text>
              <Text size="sm" c="dimmed">SHIF admission, preauthorization, ward transfer, billing, and discharge.</Text>
            </div>
            {status && <Badge color={task?.status === 'completed' ? 'green' : 'blue'}>{status}</Badge>}
          </Group>
          {!payerCase && (
            <>
              <SegmentedControl value={admissionPath} onChange={(value) => setAdmissionPath(value as AdmissionPath)} data={[{ value: 'per-diem', label: 'SHIF per diem' }, { value: 'ffs', label: 'SHIF fee-for-service' }]} />
              <Group grow align="start">
                <TextInput label="Identification number" value={identificationNumber} onChange={(event) => setIdentificationNumber(event.currentTarget.value)} required />
                <Select label="Identification type" value={identificationType} onChange={(value) => setIdentificationType(value ?? 'national-id')} data={['national-id', 'passport', 'alien-id']} />
              </Group>
              <TextInput label="SHIF inpatient intervention code" value={interventionCode} onChange={(event) => setInterventionCode(event.currentTarget.value)} required />
              <ResourceInput resourceType="Location" name="inpatient-ward" label="Admitting ward or bed" defaultValue={location} searchCriteria={INPATIENT_LOCATION_SEARCH} onChange={setLocation} />
              <Group justify="flex-end"><Button onClick={startWorkflow} loading={busyAction === 'start'} rightSection={<IconArrowRight size={16} />}>Check eligibility and admit</Button></Group>
            </>
          )}
        </Stack>
      </Paper>

      {error && <Alert color="red" icon={<IconAlertCircle size={16} />} title="Workflow action failed">{error}</Alert>}

      {payerCase && (
        <Paper withBorder p="md" radius="sm">
          <Stack gap="md">
            <Group gap="xs">
              <Badge variant="light">{payerCase.paymentMechanism === 'PER_DIEM' ? 'SHIF per diem' : 'SHIF fee-for-service'}</Badge>
              {payerCase.preauthPath && <Badge variant="outline">{payerCase.preauthPath} preauthorization</Badge>}
            </Group>
            <Text size="sm" c="dimmed">Case {payerCase.taskId}</Text>
            <Group grow align="end">
              <TextInput label="Admission OTP" value={admissionOtp} onChange={(event) => setAdmissionOtp(event.currentTarget.value)} />
              <TextInput label="Biometric authorization GUID" value={admissionAuthGuid} onChange={(event) => setAdmissionAuthGuid(event.currentTarget.value)} />
              <Button onClick={createVisit} loading={busyAction === 'create-visit'}>Create inpatient visit</Button>
            </Group>
            {requiresPreauth && (
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
            <Textarea label="Billing JSON" autosize minRows={4} value={billing} onChange={(event) => setBilling(event.currentTarget.value)} />
            <Group justify="flex-end"><Button variant="default" onClick={addBilling} loading={busyAction === 'billing'}>Add billing</Button></Group>
            <Divider />
            <Text fw={600} size="sm">Ward transfer</Text>
            <Group grow align="end">
              <ResourceInput resourceType="Location" name="destination-ward" label="Destination ward or bed" defaultValue={transferLocation} searchCriteria={INPATIENT_LOCATION_SEARCH} onChange={setTransferLocation} />
              <TextInput label="New intervention code" value={transferInterventionCode} onChange={(event) => setTransferInterventionCode(event.currentTarget.value)} />
              <Button variant="default" onClick={switchWard} loading={busyAction === 'switch-intervention'} leftSection={<IconRepeat size={16} />}>Switch intervention</Button>
            </Group>
            <Divider />
            <Text fw={600} size="sm">Discharge and claim submission</Text>
            <Group grow align="end">
              <TextInput label="Verified contact ID" value={dischargeContactId} onChange={(event) => setDischargeContactId(event.currentTarget.value)} inputMode="numeric" />
              <Button variant="default" onClick={sendDischargeOtp} loading={busyAction === 'send-discharge-otp'}>Send discharge OTP</Button>
            </Group>
            <Group grow align="start">
              <TextInput label="Discharge OTP" value={dischargeOtp} onChange={(event) => setDischargeOtp(event.currentTarget.value)} />
              <TextInput label="Biometric authorization GUID" value={dischargeAuthGuid} onChange={(event) => setDischargeAuthGuid(event.currentTarget.value)} />
              <TextInput label="Discharge date" type="date" value={dischargeDate} onChange={(event) => setDischargeDate(event.currentTarget.value)} required />
              <TextInput label="Invoice number" value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.currentTarget.value)} required />
            </Group>
            <Select label="Discharge reason" value={dischargeReason} onChange={(value) => setDischargeReason(value ?? 'RECOVERED')} data={['RECOVERED', 'REFERRED', 'DECEASED', 'AGAINST_MEDICAL_ADVICE']} />
            {isDeceased && (
              <Group grow align="start">
                <TextInput label="Next-of-kin full name" value={nextOfKinFullName} onChange={(event) => setNextOfKinFullName(event.currentTarget.value)} required />
                <TextInput label="Next-of-kin identification number" value={nextOfKinIdNumber} onChange={(event) => setNextOfKinIdNumber(event.currentTarget.value)} required />
                <Select label="Next-of-kin ID type" value={nextOfKinIdNumberType} onChange={(value) => setNextOfKinIdNumberType(value ?? 'national-id')} data={['national-id', 'passport', 'alien-id']} />
                <TextInput label="Next-of-kin contact" value={nextOfKinContactValue} onChange={(event) => setNextOfKinContactValue(event.currentTarget.value)} required />
              </Group>
            )}
            <Group justify="flex-end"><Button color="teal" onClick={discharge} loading={busyAction === 'discharge'} rightSection={<IconSend size={16} />}>Discharge and submit claim</Button></Group>
            {result !== undefined && <Alert color="green" icon={<IconCheck size={16} />} title="Latest workflow response"><Text component="pre" size="xs" style={{ overflowX: 'auto', whiteSpace: 'pre-wrap' }}>{JSON.stringify(result, null, 2)}</Text></Alert>}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}