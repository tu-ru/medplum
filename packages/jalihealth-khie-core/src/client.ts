// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import { KhieApiError } from './errors';
import type { KhieApiCall, KhieClientOptions, KhieConfig, KhieFetch, KhieTokenResponse } from './types';

export type KhieEligibilityResponse = {
  memberCrNumber?: string;
  fullName?: string;
  whitelistedForOTP?: boolean;
  facilityBiometricsEnforced?: boolean;
  schemes?: Array<{
    coverage?: { status?: string; startDate?: string; endDate?: string; message?: string; reason?: string };
    policy?: { number?: string; startDate?: string; endDate?: string };
  }>;
};

export type KhieIntervention = {
  interventionCode?: string;
  fund?: string;
  accessPoint?: 'OP' | 'IP' | string;
  paymentMechanism?: 'CAPITATION' | 'FEE_FOR_SERVICE' | string;
  needsPreauth?: boolean;
  needsManualPreauthApproval?: boolean;
  needsDoctorAuthorization?: boolean;
  requiredPreauthDocumentTypes?: string[];
  optionalPreauthDocumentTypes?: string[];
  diagnosisList?: string[];
  diagnosisBlock?: string[];
};

export type KhieContact = {
  contact_id: number;
  masked_contact?: string;
  contact_type?: string;
};

type JsonObject = Record<string, unknown>;

export class KhieClient {
  private accessToken: string | undefined;
  private tokenExpiresAt = 0;
  private readonly fetchImpl: KhieFetch;

  constructor(
    private readonly config: KhieConfig,
    private readonly options: KhieClientOptions = {}
  ) {
    this.fetchImpl = options.fetch ?? (fetch as KhieFetch);
  }

  async getEligibility(identificationNumber: string, identificationType: string): Promise<KhieEligibilityResponse> {
    return this.get('/patients/eligibility', { identification_number: identificationNumber, identification_type: identificationType });
  }

  async getInterventions(patientId: string): Promise<KhieIntervention[]> {
    return this.get('/patients/benefits/interventions', { patient_id: patientId });
  }

  async getPatientContacts(patientId: string): Promise<KhieContact[]> {
    return this.get('/patients/contacts', { patient_id: patientId });
  }

  async sendOtp(body: JsonObject): Promise<JsonObject> {
    return this.post('/claims/otp', body);
  }

  async authorize(body: JsonObject): Promise<JsonObject> {
    return this.post('/claims/authorize', body);
  }

  async createVisit(body: JsonObject): Promise<JsonObject> {
    return this.post('/claims/visit', body);
  }

  async addClaimLines(body: JsonObject): Promise<JsonObject> {
    return this.post('/claims/lines', body);
  }

  async previewClaim(consentToken: string): Promise<JsonObject> {
    return this.post('/claims/preview', { consent_token: consentToken });
  }

  async submitClaim(body: JsonObject): Promise<JsonObject> {
    return this.post('/claims/submit', body);
  }

  async createPreauth(body: JsonObject): Promise<JsonObject> {
    return this.post('/preauths', body);
  }

  async getPreauthStatus(consentToken: string): Promise<JsonObject> {
    return this.get('/preauths', { consent_token: consentToken });
  }

  async cancelPreauth(body: JsonObject): Promise<JsonObject> {
    return this.post('/preauths/cancel', body);
  }

  async getPreauthDiagnosis(icdCode: string): Promise<JsonObject> {
    return this.get(`/preauths/diagnoses/${encodeURIComponent(icdCode)}`);
  }

  private async get<T>(path: string, query?: Record<string, string>): Promise<T> {
    return this.request<T>('GET', path, undefined, query);
  }

  private async post<T>(path: string, body: JsonObject): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(
    method: KhieApiCall['method'],
    path: string,
    body?: JsonObject,
    query?: Record<string, string>
  ): Promise<T> {
    const url = new URL(`${this.config.apiBaseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }

    const response = await this.fetchImpl(url.toString(), {
      method,
      headers: await this.buildHeaders(body !== undefined),
      body: body ? JSON.stringify(body) : undefined,
    }).catch((cause: unknown) => {
      throw new KhieApiError(`KHIE ${method} ${path} failed before receiving a response`, { cause });
    });
    const correlationId = response.headers.get('x-correlation-id') ?? undefined;
    await this.notify({ method, path, status: response.status, correlationId });

    if (!response.ok) {
      throw new KhieApiError(`KHIE ${method} ${path} failed with HTTP ${response.status}`, {
        status: response.status,
        correlationId,
      });
    }
    return (await response.json()) as T;
  }

  private async buildHeaders(hasBody: boolean): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.getAccessToken()}`,
      Accept: 'application/json',
    };
    if (hasBody) {
      headers['Content-Type'] = 'application/json';
    }
    if (this.config.authMode === 'multitenant-headers') {
      if (!this.config.facility) {
        throw new KhieApiError('Multitenant KHIE request has no resolved facility');
      }
      headers['X-Facility-Id'] = this.config.facility.code;
      headers['X-Facility-Id-Type'] = this.config.facility.idType;
    }
    return headers;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const response = await this.fetchImpl(this.config.tokenUrl, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret }).toString(),
    }).catch((cause: unknown) => {
      throw new KhieApiError('KHIE token request failed before receiving a response', { cause });
    });
    const correlationId = response.headers.get('x-correlation-id') ?? undefined;
    await this.notify({ method: 'POST', path: '/tenants/token', status: response.status, correlationId });

    if (!response.ok) {
      throw new KhieApiError(`KHIE token request failed with HTTP ${response.status}`, {
        status: response.status,
        correlationId,
      });
    }

    const token = (await response.json()) as KhieTokenResponse;
    if (!token.access_token || !token.expires_in) {
      throw new KhieApiError('KHIE token response did not include access_token and expires_in');
    }
    this.accessToken = token.access_token;
    this.tokenExpiresAt = Date.now() + Math.max(0, token.expires_in - 30) * 1000;
    return token.access_token;
  }

  private async notify(call: KhieApiCall): Promise<void> {
    await this.options.onApiCall?.(call);
  }
}
