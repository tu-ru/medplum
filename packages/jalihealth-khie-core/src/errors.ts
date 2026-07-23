// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

export class KhieConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KhieConfigurationError';
  }
}

export class KhieAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KhieAuthorizationError';
  }
}

export class KhieApiError extends Error {
  readonly status?: number;
  readonly retryable: boolean;
  readonly correlationId?: string;

  constructor(message: string, options: { status?: number; correlationId?: string; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'KhieApiError';
    this.status = options.status;
    this.correlationId = options.correlationId;
    this.retryable = options.status === undefined || options.status === 408 || options.status === 429 || options.status >= 500;
  }
}
