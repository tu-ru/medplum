// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import { getExtension } from '@medplum/core';
import type { Extension, Identifier, Location } from '@medplum/fhirtypes';
import {
    KHIE_FACILITY_INTEGRATION_EXTENSION_URL,
    KHIE_FACILITY_INTEGRATION_FIELDS,
    KHIE_FACILITY_REGISTRY_SYSTEM,
} from './constants';
import type {
    KhieClaimAccessPoint,
    KhieEnvironment,
    KhieFacilityIdentity,
    KhieFacilityIdType,
    KhieFacilityIntegrationProfile,
    KhieFacilityStatus,
    KhieFund,
} from './types';

export function getKhieFacilityIdentity(location: Location): KhieFacilityIdentity | undefined {
  const identifier = location.identifier?.find((value) => value.system === KHIE_FACILITY_REGISTRY_SYSTEM && value.value);
  const profile = getKhieFacilityIntegrationProfile(location);
  const type = identifier?.type?.text as KhieFacilityIdType | undefined;

  if (!identifier?.value || !type || !profile) {
    return undefined;
  }

  return { code: identifier.value, type, profile };
}

export function getKhieFacilityIntegrationProfile(location: Location): KhieFacilityIntegrationProfile | undefined {
  const extension = getExtension(location, KHIE_FACILITY_INTEGRATION_EXTENSION_URL);
  if (!extension?.extension) {
    return undefined;
  }

  const getCode = (url: string): string | undefined => extension.extension?.find((value) => value.url === url)?.valueCode;
  const getString = (url: string): string | undefined => extension.extension?.find((value) => value.url === url)?.valueString;
  const enabled = extension.extension.find((value) => value.url === KHIE_FACILITY_INTEGRATION_FIELDS.enabled)?.valueBoolean;
  const status = getCode(KHIE_FACILITY_INTEGRATION_FIELDS.status) as KhieFacilityStatus | undefined;

  if (enabled === undefined || !status) {
    return undefined;
  }

  return {
    enabled,
    status,
    environment: getCode(KHIE_FACILITY_INTEGRATION_FIELDS.environment) as KhieEnvironment | undefined,
    supportedFunds: extension.extension
      .filter((value) => value.url === KHIE_FACILITY_INTEGRATION_FIELDS.supportedFund)
      .map((value) => value.valueCode as KhieFund),
    claimAccessPoints: extension.extension
      .filter((value) => value.url === KHIE_FACILITY_INTEGRATION_FIELDS.claimAccessPoint)
      .map((value) => value.valueCode as KhieClaimAccessPoint),
    tenantId: getString(KHIE_FACILITY_INTEGRATION_FIELDS.tenantId),
  };
}

export function setKhieFacilityIdentity(
  location: Location,
  identity: Omit<KhieFacilityIdentity, 'profile'>,
  profile: KhieFacilityIntegrationProfile
): Location {
  const identifier: Identifier = {
    system: KHIE_FACILITY_REGISTRY_SYSTEM,
    value: identity.code,
    type: { text: identity.type },
  };
  const integrationExtension: Extension = {
    url: KHIE_FACILITY_INTEGRATION_EXTENSION_URL,
    extension: [
      { url: KHIE_FACILITY_INTEGRATION_FIELDS.enabled, valueBoolean: profile.enabled },
      { url: KHIE_FACILITY_INTEGRATION_FIELDS.status, valueCode: profile.status },
      ...optionalCodeExtension(KHIE_FACILITY_INTEGRATION_FIELDS.environment, profile.environment),
      ...profile.supportedFunds.map((valueCode) => ({ url: KHIE_FACILITY_INTEGRATION_FIELDS.supportedFund, valueCode })),
      ...profile.claimAccessPoints.map((valueCode) => ({ url: KHIE_FACILITY_INTEGRATION_FIELDS.claimAccessPoint, valueCode })),
      ...optionalStringExtension(KHIE_FACILITY_INTEGRATION_FIELDS.tenantId, profile.tenantId),
    ],
  };

  return {
    ...location,
    identifier: [...(location.identifier ?? []).filter((value) => value.system !== KHIE_FACILITY_REGISTRY_SYSTEM), identifier],
    extension: [
      ...(location.extension ?? []).filter((value) => value.url !== KHIE_FACILITY_INTEGRATION_EXTENSION_URL),
      integrationExtension,
    ],
  };
}

function optionalCodeExtension(url: string, value: string | undefined): Extension[] {
  return value ? [{ url, valueCode: value }] : [];
}

function optionalStringExtension(url: string, value: string | undefined): Extension[] {
  return value ? [{ url, valueString: value }] : [];
}
