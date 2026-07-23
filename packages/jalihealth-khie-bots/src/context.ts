// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import { getReferenceString, type BotEvent, type MedplumClient } from '@medplum/core';
import type { Encounter, Location, Patient, PractitionerRole, Reference } from '@medplum/fhirtypes';
import {
    assertUserAssignedToFacility,
    getKhieConfig,
    KhieClient,
    resolveFacilityContext,
    type ResolvedKhieFacility,
} from '@medplum/jalihealth-khie-core';
import type { KhieWorkflowDependencies, KhieWorkflowInput } from './types';

export type KhieWorkflowContext = {
  patient: Patient;
  practitionerRole: PractitionerRole;
  encounter?: Encounter;
  facility: ResolvedKhieFacility;
  client: KhieClient;
};

export async function getKhieWorkflowContext<T extends KhieWorkflowInput>(
  medplum: MedplumClient,
  event: BotEvent<T>,
  input: T,
  dependencies: KhieWorkflowDependencies = {}
): Promise<KhieWorkflowContext> {
  const patient = await readReference(medplum, input.patient, 'Patient');
  const practitionerRole = await readReference(medplum, input.practitionerRole, 'PractitionerRole');
  const encounter = input.encounter ? await readReference(medplum, input.encounter, 'Encounter') : undefined;
  const locations = await medplum.searchResources('Location', {
    'managing-organization': practitionerRole.organization?.reference,
  });
  const locationsByReference = new Map(locations.filter((location) => location.id).map((location) => [`Location/${location.id}`, location]));
  const resolveLocation = (reference: Reference<Location>): Location | undefined => locationsByReference.get(getReferenceString(reference));
  const facility = resolveFacilityContext({
    encounter,
    patientLocation: input.patientLocation,
    selectedLocation: input.selectedLocation,
    practitionerRole,
    organizationLocations: locations,
    resolveLocation,
  });
  assertUserAssignedToFacility(practitionerRole, facility, resolveLocation);

  const client = dependencies.createClient?.(getKhieConfig(event, facility)) ?? new KhieClient(getKhieConfig(event, facility));
  return { patient, practitionerRole, encounter, facility, client };
}

async function readReference<T extends Patient | PractitionerRole | Encounter>(
  medplum: MedplumClient,
  reference: Reference<T>,
  resourceType: T['resourceType']
): Promise<T> {
  const referenceString = getReferenceString(reference);
  const [referenceType, id] = referenceString.split('/');
  if (referenceType !== resourceType || !id || referenceString.split('/').length !== 2) {
    throw new Error(`Expected a ${resourceType} reference`);
  }
  return medplum.readResource(resourceType, id) as Promise<T>;
}