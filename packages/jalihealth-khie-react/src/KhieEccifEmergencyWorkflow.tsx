// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import { Alert, Badge, Button, Divider, Group, Paper, SegmentedControl, Select, Stack, Table, Text, TextInput, Textarea } from '@mantine/core';
import { createReference, normalizeErrorString } from '@medplum/core';
import type { Location, Patient, PractitionerRole, Task } from '@medplum/fhirtypes';
import { ResourceInput, useMedplum } from '@medplum/react';
import { IconAlertCircle, IconArrowRight, IconCheck, IconRefresh, IconSend } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useState } from 'react';
import type { KhieEccifEmergencyPayerCase, KhieEccifWorkflowBotIdentifiers } from './types';

export interface KhieEccifEmergencyWorkflowProps {
  readonly practitionerRole: PractitionerRole;
  readonly bots: KhieEccifWorkflowBotIdentifiers;
  readonly patient?: Patient;
  readonly initialLocation?: Location;
  readonly onCaseCreated?: (payerCase: KhieEccifEmergencyPayerCase) => void;
}

type EmergencyIdentity = 'identified' | 'unidentified';
type EmergencyProtocol = Record<string, unknown>;

export function KhieEccifEmergencyWorkflow(props: KhieEccifEmergencyWorkflowProps): JSX.Element {
  const medplum = useMedplum();
  const [identity, setIdentity] = useState<EmergencyIdentity>(props.patient ? 'identified' : 'unidentified');
  const [knownPatient, setKnownPatient] = useState<Patient | undefined>(props.patient);
  const [location, setLocation] = useState<Location | undefined>(props.initialLocation);
  const [interventionCode, setInterventionCode] = useState('');
  const [beneficiaryCrId, setBeneficiaryCrId] = useState('');
  const [otp, setOtp] = useState('');
  const [modeOfArrival, setModeOfArrival] = useState('AMBULANCE');
  const [broughtBy, setBroughtBy] = useState('PARAMEDICS');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [practitionerIdentificationNumber, setPractitionerIdentificationNumber] = useState('');
  const [practitionerIdentificationType, setPractitionerIdentificationType] = useState('registration_number');
  const [regulationBody, setRegulationBody] = useState('KMPDC');
  const [notes, setNotes] = useState('');
  const [payerCase, setPayerCase] = useState<KhieEccifEmergencyPayerCase>();
  const [task, setTask] = useState<Task>();
  const [doctorIdentificationNumber, setDoctorIdentificationNumber] = useState('');
  const [protocols, setProtocols] = useState<EmergencyProtocol[]>([]);
  const [protocol, setProtocol] = useState('{\n  "protocol_code": ""\n}');
  const [identifiedPatient, setIdentifiedPatient] = useState<Patient>();
  const [identificationCrId, setIdentificationCrId] = useState('');
  const [identificationOtp, setIdentificationOtp] = useState('');
  const [dischargeReason, setDischargeReason] = useState('RECOVERED');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [reasonForUnknownPatient, setReasonForUnknownPatient] = useState('SHA_UNREGISTERED');
  const [busyAction, setBusyAction] = useState<string>();
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<unknown>();

  const practitionerRoleReference = createReference(props.practitionerRole);
  const status = task?.businessStatus?.coding?.[0]?.display ?? task?.businessStatus?.coding?.[0]?.code;

  function getCaseInput(): Record<string, unknown> {
    if (!payerCase) {
      throw new Error('Create an ECCIF emergency claim before continuing');
    }
    return {
      patient: createReference(payerCase.patient),
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

  async function createEmergencyClaim(): Promise<void> {
    if (!interventionCode.trim() || !referenceNumber.trim() || !practitionerIdentificationNumber.trim()) {
      setError('Enter the intervention code, emergency reference number, and practitioner identification number.');
      return;
    }
    if (identity === 'identified' && (!knownPatient || !beneficiaryCrId.trim() || !otp.trim())) {
      setError('An identified emergency claim requires a patient, beneficiary CR ID, and OTP.');
      return;
    }
    const actionResult = await runAction('create-claim', () =>
      medplum.executeBot(props.bots.createEccifEmergencyClaim, {
        practitionerRole: practitionerRoleReference,
        ...(location ? { selectedLocation: createReference(location) } : {}),
        ...(identity === 'identified' && knownPatient ? { patient: createReference(knownPatient), beneficiaryCrId: beneficiaryCrId.trim(), otp: otp.trim() } : {}),
        interventionCode: interventionCode.trim(),
        modeOfArrival,
        broughtBy,
        referenceNumber: referenceNumber.trim(),
        practitionerIdentificationNumber: practitionerIdentificationNumber.trim(),
        practitionerIdentificationType,
        regulationBody,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      }) as Promise<KhieEccifEmergencyPayerCase>
    );
    if (!actionResult) {
      return;
    }
    setPayerCase(actionResult);
    setTask(await medplum.readResource('Task', actionResult.taskId));
    props.onCaseCreated?.(actionResult);
  }

  async function resendDoctorConsent(): Promise<void> {
    if (!doctorIdentificationNumber.trim()) {
      setError('Enter the doctor identification number.');
      return;
    }
    await runAction('resend-consent', () =>
      medplum.executeBot(props.bots.resendEccifDoctorConsent, { ...getCaseInput(), doctorIdentificationNumber: doctorIdentificationNumber.trim() })
    );
  }

  async function getProtocols(): Promise<void> {
    const actionResult = await runAction('get-protocols', () =>
      medplum.executeBot(props.bots.getEccifEmergencyProtocol, getCaseInput()) as Promise<EmergencyProtocol[]>
    );
    if (actionResult) {
      setProtocols(actionResult);
    }
  }

  async function addProtocol(): Promise<void> {
    const parsedProtocol = parseObject(protocol, 'emergency protocol');
    if (!parsedProtocol) {
      return;
    }
    await runAction('add-protocol', () => medplum.executeBot(props.bots.addEccifEmergencyProtocol, { ...getCaseInput(), protocol: parsedProtocol }));
  }

  async function identifyPatient(): Promise<void> {
    if (!payerCase || !identifiedPatient || !identificationCrId.trim() || !identificationOtp.trim()) {
      setError('Choose the identified patient and enter the beneficiary CR ID and OTP.');
      return;
    }
    const actionResult = await runAction('identify-patient', () =>
      medplum.executeBot(props.bots.identifyEccifEmergencyPatient, {
        ...getCaseInput(),
        patient: createReference(identifiedPatient),
        beneficiaryCrId: identificationCrId.trim(),
        otp: identificationOtp.trim(),
      })
    );
    if (actionResult) {
      setPayerCase({ ...payerCase, patient: identifiedPatient, unidentified: false });
    }
  }

  async function submitClaim(): Promise<void> {
    if (!invoiceNumber.trim()) {
      setError('Enter the invoice number before submitting the claim.');
      return;
    }
    await runAction('submit-claim', () =>
      medplum.executeBot(props.bots.previewAndSubmitEccifClaim, {
        ...getCaseInput(),
        dischargeReason,
        invoiceNumber: invoiceNumber.trim(),
        ...(payerCase?.unidentified ? { reasonForUnknownPatient } : {}),
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

  return (
    <Stack gap="md" data-testid="khie-eccif-emergency-workflow">
      <Paper withBorder p="md" radius="sm">
        <Stack gap="md">
          <Group justify="space-between" align="center">
            <div>
              <Text fw={700}>ECCIF emergency claim</Text>
              <Text size="sm" c="dimmed">Emergency authorization, clinical protocols, identity reconciliation, and claim submission.</Text>
            </div>
            {status && <Badge color={task?.status === 'completed' ? 'green' : 'blue'}>{status}</Badge>}
          </Group>
          {!payerCase && (
            <>
              <SegmentedControl value={identity} onChange={(value) => setIdentity(value as EmergencyIdentity)} data={[{ value: 'identified', label: 'Identified patient' }, { value: 'unidentified', label: 'Unidentified patient' }]} />
              {identity === 'identified' && <ResourceInput resourceType="Patient" name="eccif-patient" label="Patient" defaultValue={knownPatient} onChange={setKnownPatient} required />}
              <Group grow align="start">
                <TextInput label="ECCIF intervention code" value={interventionCode} onChange={(event) => setInterventionCode(event.currentTarget.value)} required />
                <TextInput label="Emergency reference number" value={referenceNumber} onChange={(event) => setReferenceNumber(event.currentTarget.value)} required />
              </Group>
              {identity === 'identified' && <Group grow align="start"><TextInput label="Beneficiary CR ID" value={beneficiaryCrId} onChange={(event) => setBeneficiaryCrId(event.currentTarget.value)} required /><TextInput label="OTP" value={otp} onChange={(event) => setOtp(event.currentTarget.value)} required /></Group>}
              <Group grow align="start">
                <Select label="Mode of arrival" value={modeOfArrival} onChange={(value) => setModeOfArrival(value ?? 'AMBULANCE')} data={['AMBULANCE', 'WALK-IN', 'OTHER']} />
                <Select label="Brought by" value={broughtBy} onChange={(value) => setBroughtBy(value ?? 'PARAMEDICS')} data={['RELATIVE', 'UNKNOWN', 'SAMARITAN', 'PARAMEDICS']} />
                <ResourceInput resourceType="Location" name="eccif-location" label="Emergency location" defaultValue={location} onChange={setLocation} />
              </Group>
              <Group grow align="start">
                <TextInput label="Practitioner identification number" value={practitionerIdentificationNumber} onChange={(event) => setPractitionerIdentificationNumber(event.currentTarget.value)} required />
                <TextInput label="Practitioner identification type" value={practitionerIdentificationType} onChange={(event) => setPractitionerIdentificationType(event.currentTarget.value)} required />
                <Select label="Regulation body" value={regulationBody} onChange={(value) => setRegulationBody(value ?? 'KMPDC')} data={['KMPDC', 'COC', 'NCK']} />
              </Group>
              <Textarea label="Clinical notes" value={notes} onChange={(event) => setNotes(event.currentTarget.value)} autosize minRows={2} />
              <Group justify="flex-end"><Button onClick={createEmergencyClaim} loading={busyAction === 'create-claim'} rightSection={<IconArrowRight size={16} />}>Create emergency claim</Button></Group>
            </>
          )}
        </Stack>
      </Paper>

      {error && <Alert color="red" icon={<IconAlertCircle size={16} />} title="Workflow action failed">{error}</Alert>}

      {payerCase && (
        <Paper withBorder p="md" radius="sm">
          <Stack gap="md">
            <Group gap="xs"><Badge variant="light">ECCIF emergency</Badge><Badge variant="outline">{payerCase.unidentified ? 'unidentified patient' : 'identified patient'}</Badge></Group>
            <Text size="sm" c="dimmed">Case {payerCase.taskId}</Text>
            <Group grow align="end">
              <TextInput label="Doctor identification number" value={doctorIdentificationNumber} onChange={(event) => setDoctorIdentificationNumber(event.currentTarget.value)} />
              <Button variant="default" onClick={resendDoctorConsent} loading={busyAction === 'resend-consent'}>Resend doctor consent</Button>
            </Group>
            <Divider />
            <Group justify="space-between"><Text fw={600} size="sm">Emergency protocols</Text><Button variant="default" onClick={getProtocols} loading={busyAction === 'get-protocols'} leftSection={<IconRefresh size={16} />}>Load protocols</Button></Group>
            {protocols.length > 0 && <Table striped withTableBorder withColumnBorders><Table.Thead><Table.Tr><Table.Th>Protocol code</Table.Th><Table.Th>Applicable tariff</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{protocols.map((item, index) => <Table.Tr key={String(item.protocol_code ?? item.protocolCode ?? index)}><Table.Td>{String(item.protocol_code ?? item.protocolCode ?? '')}</Table.Td><Table.Td>{String(item.applicable_tariff ?? item.applicableTariff ?? '')}</Table.Td></Table.Tr>)}</Table.Tbody></Table>}
            <Textarea label="Emergency protocol JSON" autosize minRows={3} value={protocol} onChange={(event) => setProtocol(event.currentTarget.value)} />
            <Group justify="flex-end"><Button variant="default" onClick={addProtocol} loading={busyAction === 'add-protocol'}>Add protocol</Button></Group>
            {payerCase.unidentified && <><Divider /><Text fw={600} size="sm">Identify patient</Text><ResourceInput resourceType="Patient" name="identified-eccif-patient" label="Identified patient" defaultValue={identifiedPatient} onChange={setIdentifiedPatient} /><Group grow align="end"><TextInput label="Beneficiary CR ID" value={identificationCrId} onChange={(event) => setIdentificationCrId(event.currentTarget.value)} /><TextInput label="OTP" value={identificationOtp} onChange={(event) => setIdentificationOtp(event.currentTarget.value)} /><Button onClick={identifyPatient} loading={busyAction === 'identify-patient'}>Identify patient</Button></Group></>}
            <Divider />
            <Text fw={600} size="sm">Submit emergency claim</Text>
            <Group grow align="start"><Select label="Discharge reason" value={dischargeReason} onChange={(value) => setDischargeReason(value ?? 'RECOVERED')} data={['RECOVERED', 'REFERRED', 'DECEASED', 'ABSCONDED', 'OTHER']} /><TextInput label="Invoice number" value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.currentTarget.value)} required />{payerCase.unidentified && <Select label="Reason for unknown patient" value={reasonForUnknownPatient} onChange={(value) => setReasonForUnknownPatient(value ?? 'SHA_UNREGISTERED')} data={['SHA_UNREGISTERED', 'DECEASED']} />}</Group>
            <Group justify="flex-end"><Button color="teal" onClick={submitClaim} loading={busyAction === 'submit-claim'} rightSection={<IconSend size={16} />}>Preview and submit claim</Button></Group>
            {result !== undefined && <Alert color="green" icon={<IconCheck size={16} />} title="Latest workflow response"><Text component="pre" size="xs" style={{ overflowX: 'auto', whiteSpace: 'pre-wrap' }}>{JSON.stringify(result, null, 2)}</Text></Alert>}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}