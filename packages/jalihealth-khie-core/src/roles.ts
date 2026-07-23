// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import { getExtension } from '@medplum/core';
import type { PractitionerRole, Reference } from '@medplum/fhirtypes';
import { JALIHEALTH_DEFAULT_LOCATION_EXTENSION_URL, JALIHEALTH_ROLE_SYSTEM } from './constants';
import type { JaliHealthRole, PractitionerRoleAssignmentInput } from './types';

export function createPractitionerRoleAssignment(input: PractitionerRoleAssignmentInput): PractitionerRole {
  return {
    resourceType: 'PractitionerRole',
    active: true,
    practitioner: input.practitioner,
    organization: input.organization,
    location: input.locations,
    code: [{ coding: [{ system: JALIHEALTH_ROLE_SYSTEM, code: input.role }] }],
    extension: input.defaultLocation
      ? [{ url: JALIHEALTH_DEFAULT_LOCATION_EXTENSION_URL, valueReference: input.defaultLocation }]
      : undefined,
  };
}

export function getJaliHealthRole(practitionerRole: PractitionerRole): JaliHealthRole | undefined {
  return practitionerRole.code
    ?.flatMap((concept) => concept.coding ?? [])
    .find((coding) => coding.system === JALIHEALTH_ROLE_SYSTEM)?.code as JaliHealthRole | undefined;
}

export function getDefaultLocation(practitionerRole: PractitionerRole): Reference | undefined {
  return getExtension(practitionerRole, JALIHEALTH_DEFAULT_LOCATION_EXTENSION_URL)?.valueReference;
}
