// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { BotEvent, ProjectSetting } from '@medplum/core';
import { KhieConfigurationError } from './errors';
import type { KhieAuthMode, KhieConfig, KhieEnvironment, ResolvedKhieFacility } from './types';

const SECRET_NAMES = {
  environment: 'KHIE_ENVIRONMENT',
  authMode: 'KHIE_AUTH_MODE',
  clientId: 'KHIE_CLIENT_ID',
  clientSecret: 'KHIE_CLIENT_SECRET',
  tokenUrl: 'KHIE_TOKEN_URL',
  apiBaseUrl: 'KHIE_API_BASE_URL',
} as const;

export function getKhieConfig(event: Pick<BotEvent, 'secrets'>, facility?: ResolvedKhieFacility): KhieConfig {
  const environment = requiredString(event.secrets, SECRET_NAMES.environment) as KhieEnvironment;
  const authMode = optionalString(event.secrets, SECRET_NAMES.authMode, 'multitenant-headers') as KhieAuthMode;

  if (!['mock', 'sandbox', 'production'].includes(environment)) {
    throw new KhieConfigurationError(`Invalid ${SECRET_NAMES.environment}: ${environment}`);
  }
  if (!['facility-scoped-jwt', 'multitenant-headers'].includes(authMode)) {
    throw new KhieConfigurationError(`Invalid ${SECRET_NAMES.authMode}: ${authMode}`);
  }
  if (authMode === 'multitenant-headers' && !facility) {
    throw new KhieConfigurationError('A resolved KHIE facility is required for multitenant headers');
  }

  return {
    environment,
    authMode,
    clientId: requiredString(event.secrets, SECRET_NAMES.clientId),
    clientSecret: requiredString(event.secrets, SECRET_NAMES.clientSecret),
    tokenUrl: requiredString(event.secrets, SECRET_NAMES.tokenUrl),
    apiBaseUrl: trimTrailingSlash(requiredString(event.secrets, SECRET_NAMES.apiBaseUrl)),
    facility: facility ? { code: facility.code, idType: facility.idType } : undefined,
  };
}

function requiredString(secrets: Record<string, ProjectSetting>, name: string): string {
  const value = secrets[name]?.valueString;
  if (!value) {
    throw new KhieConfigurationError(`Missing required KHIE Project Secret: ${name}`);
  }
  return value;
}

function optionalString(secrets: Record<string, ProjectSetting>, name: string, defaultValue: string): string {
  return secrets[name]?.valueString ?? defaultValue;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
