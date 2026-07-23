// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { StructureDefinition } from '@medplum/fhirtypes';
import { JALIHEALTH_DEFAULT_LOCATION_EXTENSION_URL, KHIE_FACILITY_INTEGRATION_EXTENSION_URL } from './constants';

export function createKhieFacilityIntegrationStructureDefinition(): StructureDefinition {
  return {
    resourceType: 'StructureDefinition',
    url: KHIE_FACILITY_INTEGRATION_EXTENSION_URL,
    name: 'KhieFacilityIntegration',
    title: 'KHIE Facility Integration',
    status: 'active',
    experimental: false,
    publisher: 'JaliHealth',
    description: 'KHIE integration configuration for a facility-level Location.',
    fhirVersion: '4.0.1',
    kind: 'complex-type',
    abstract: false,
    context: [{ type: 'element', expression: 'Location' }],
    type: 'Extension',
    baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Extension',
    derivation: 'constraint',
    differential: {
      element: [
        { id: 'Extension', path: 'Extension', min: 0, max: '1' },
        { id: 'Extension.extension', path: 'Extension.extension', min: 1, max: '*' },
        { id: 'Extension.extension:url', path: 'Extension.extension.url', min: 1, max: '1' },
        { id: 'Extension.value[x]', path: 'Extension.value[x]', max: '0' },
      ],
    },
  };
}

export function createDefaultLocationStructureDefinition(): StructureDefinition {
  return {
    resourceType: 'StructureDefinition',
    url: JALIHEALTH_DEFAULT_LOCATION_EXTENSION_URL,
    name: 'JaliHealthDefaultLocation',
    title: 'JaliHealth Default Working Location',
    status: 'active',
    experimental: false,
    publisher: 'JaliHealth',
    description: 'The default working Location for a PractitionerRole.',
    fhirVersion: '4.0.1',
    kind: 'complex-type',
    abstract: false,
    context: [{ type: 'element', expression: 'PractitionerRole' }],
    type: 'Extension',
    baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Extension',
    derivation: 'constraint',
    differential: {
      element: [
        { id: 'Extension', path: 'Extension', min: 0, max: '1' },
        { id: 'Extension.extension', path: 'Extension.extension', max: '0' },
        { id: 'Extension.value[x]', path: 'Extension.value[x]', min: 1, max: '1', type: [{ code: 'Reference' }] },
      ],
    },
  };
}
