// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import { getReferenceString } from '@medplum/core';
import type { Location, PractitionerRole, Reference } from '@medplum/fhirtypes';
import { KhieAuthorizationError, KhieConfigurationError } from './errors';
import { getKhieFacilityIdentity } from './facility';
import { getDefaultLocation } from './roles';
import type { FacilityContextInput, FacilityResolver, ResolvedKhieFacility } from './types';

export function resolveKhieFacility(
  locationReference: Reference<Location>,
  resolveLocation: FacilityResolver,
  source: ResolvedKhieFacility['source']
): ResolvedKhieFacility | undefined {
  const visited = new Set<string>();
  let currentReference: Reference<Location> | undefined = locationReference;

  while (currentReference) {
    const reference = getReferenceString(currentReference);
    if (!reference || visited.has(reference)) {
      return undefined;
    }
    visited.add(reference);

    const location = resolveLocation(currentReference);
    if (!location) {
      return undefined;
    }
    const identity = getKhieFacilityIdentity(location);
    if (identity) {
      if (!identity.profile.enabled || identity.profile.status !== 'active') {
        throw new KhieConfigurationError(`KHIE is not active for Location/${location.id ?? location.name ?? 'unknown'}`);
      }
      return { facility: location, code: identity.code, idType: identity.type, profile: identity.profile, source };
    }
    currentReference = location.partOf;
  }

  return undefined;
}

export function resolveFacilityContext(input: FacilityContextInput): ResolvedKhieFacility {
  const candidates: [Reference<Location> | undefined, ResolvedKhieFacility['source']][] = [
    [getActiveEncounterLocation(input), 'encounter'],
    [input.patientLocation, 'patient-location'],
    [input.selectedLocation, 'selected-location'],
    [getDefaultLocation(input.practitionerRole) as Reference<Location> | undefined, 'default-location'],
  ];

  for (const [location, source] of candidates) {
    if (!location) {
      continue;
    }
    const resolved = resolveKhieFacility(location, input.resolveLocation, source);
    if (resolved) {
      return resolved;
    }
  }

  const organizationFacilities = (input.organizationLocations ?? [])
    .filter((location) => getKhieFacilityIdentity(location)?.profile.enabled && getKhieFacilityIdentity(location)?.profile.status === 'active');
  if (organizationFacilities.length === 1 && organizationFacilities[0].id) {
    const resolved = resolveKhieFacility(
      { reference: `Location/${organizationFacilities[0].id}` },
      input.resolveLocation,
      'organization-default'
    );
    if (resolved) {
      return resolved;
    }
  }

  throw new KhieConfigurationError('Unable to resolve one unambiguous active KHIE facility');
}

export function assertUserAssignedToFacility(
  practitionerRole: PractitionerRole,
  facility: ResolvedKhieFacility,
  resolveLocation: FacilityResolver
): void {
  const authorizedReferences = practitionerRole.location ?? [];
  const authorizedFacilityReferences = new Set<string>();

  for (const reference of authorizedReferences) {
    const authorized = resolveKhieFacility(reference, resolveLocation, 'selected-location');
    if (authorized) {
      authorizedFacilityReferences.add(`Location/${authorized.facility.id}`);
    }
  }

  if (!facility.facility.id || !authorizedFacilityReferences.has(`Location/${facility.facility.id}`)) {
    throw new KhieAuthorizationError('The requesting user is not assigned to the resolved KHIE facility');
  }
}

function getActiveEncounterLocation(input: FacilityContextInput): Reference<Location> | undefined {
  const encounterLocations = input.encounter?.location ?? [];
  return encounterLocations.find((location) => location.status === 'active')?.location ?? encounterLocations.at(-1)?.location;
}
