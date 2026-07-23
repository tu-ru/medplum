# JaliHealth KHIE Capabilities within the Medplum Platform

This document describes the current JaliHealth KHIE implementation within the wider Medplum platform after the Phase A through Phase F workflow work. It is intended as a living technical context document for engineering, review, and stakeholder alignment.

It summarizes what the KHIE-enabled system currently does, how it runs, how its major workflow pieces fit together, and which compliance-oriented controls are represented in code. It does not claim external certification, legal approval, or regulatory acceptance.

## Platform Architecture Documentation

The complete PlantUML source set, including platform topology, deployment profiles, delivery lifecycle, operations, and compliance evidence, is maintained in [packages/docs/docs/integration/khie](packages/docs/docs/integration/khie). The diagrams are deliberately source-controlled and are intended to be rendered by the documentation pipeline or a PlantUML-compatible renderer.

## Executive Summary

The system implements a KHIE-enabled payer workflow stack across core client APIs, server-side bots, and React UI components. It supports outpatient, inpatient, and emergency claim flows, including identification, preauthorization, billing, ward transfer, discharge, protocol handling, and ECCIF-specific unknown-patient handling.

At a high level, the architecture is:

- `@medplum/jalihealth-khie-core`: shared KHIE REST client and facility-resolution logic.
- `@medplum/jalihealth-khie-bots`: workflow bots that orchestrate KHIE claim operations.
- `@medplum/jalihealth-khie-react`: UI components that drive the workflows from the client side.

## Implemented Workflow Surface

### 1. Core KHIE client and facility controls

The shared KHIE client layer provides HTTP wrappers for the workflow endpoints used by the bots. The client handles authentication, facility headers, token reuse, correlation-aware calls, and error translation. The facility layer resolves an active KHIE-enabled facility from Medplum `Location` resources and ensures the resolved facility is authorized for the current practitioner role.

Current core capabilities include:

- Facility identity and integration profile storage on `Location` resources.
- Active facility resolution from encounter, patient location, selected location, practitioner role defaults, or organization defaults.
- Enforcement that the resolved facility is KHIE-enabled and active.
- Authorization checks that the logged-in practitioner role is assigned to the selected facility.
- KHIE client support for outpatient, inpatient, transfer, discharge, emergency claim, doctor-consent, and protocol calls.

### 2. Outpatient payer workflow

The outpatient workflow supports both UHC and SHIF fee-for-service paths. The UI mirrors the operational sequence of a real payer workflow:

- Start a payer case from patient and practitioner context.
- Load patient contacts.
- Send OTP to a verified patient contact.
- Create the visit using OTP or biometric authorization GUID.
- Submit or authorize preauthorization depending on the workflow path.
- Refresh preauthorization status.
- Add billing lines.
- Preview and submit the final claim.

The outpatient workflow serves as the baseline user experience and architectural pattern for the rest of the KHIE UI.

### 3. Inpatient SHIF workflow

The inpatient workflow extends the outpatient pattern with admission and discharge behavior specific to inpatient claims.

Implemented inpatient capabilities include:

- Admission path selection between per-diem and fee-for-service.
- Admission into a ward or bed location.
- Visit creation after OTP or biometric authorization.
- Preauthorization handling for fee-for-service admissions.
- Billing capture.
- Ward transfer using a dedicated intervention-switch action.
- Discharge OTP sending.
- Discharge submission with discharge reason, invoice number, and optional next-of-kin details for deceased patients.

The inpatient UI now constrains ward selection to ward/bed physical types, which reduces the chance of accidentally selecting a site-level or unrelated location.

### 4. ECCIF emergency workflow

The ECCIF emergency workflow is designed to support identified and unidentified emergency cases.

Implemented ECCIF capabilities include:

- Emergency claim creation for identified patients.
- Emergency claim creation for unidentified patients using a placeholder internal `Patient` resource.
- Doctor-consent resend using the stored emergency authorization token.
- Emergency protocol lookup by intervention code.
- Emergency protocol addition.
- Patient identification after an unidentified claim has already been created.
- Emergency claim preview and submission.
- Conditional `reasonForUnknownPatient` handling for unidentified claims.

The ECCIF flow is intentionally separated from the standard payer-case helper logic because unidentified emergency cases do not have the usual KHIE patient identifier available at creation time.

## Server-Side Bot Capabilities

The bot layer orchestrates the KHIE API calls and Medplum resource mutations. It is currently the main operational engine for the workflows.

### Inpatient bots

The inpatient bot set currently supports:

- Starting an inpatient claim case.
- Creating an inpatient visit.
- Authorizing or submitting preauthorization.
- Refreshing preauthorization.
- Adding billing.
- Switching intervention and updating encounter location history.
- Sending discharge OTPs.
- Submitting discharge.

### ECCIF emergency bots

The ECCIF bot set currently supports:

- Creating emergency claims for identified or unidentified patients.
- Resending doctor-consent requests.
- Fetching emergency protocols.
- Adding emergency protocols.
- Identifying an unidentified patient later in the workflow.
- Previewing and submitting the emergency claim.

### Shared workflow patterns

Across the bot layer, the implementation follows consistent patterns:

- `createXHandler(dependencies = {})` factory functions for testability.
- A default exported `handler` for runtime usage.
- Shared workflow context resolution from Medplum resources.
- Task and Claim state updates that track business progression.
- Consent token persistence using a dedicated claim identifier system.

## React UI Capabilities

The React package exposes the workflow UIs as reusable clinical components.

### Current components

- `KhieOutpatientWorkflow`
- `KhieInpatientWorkflow`
- `KhieEccifEmergencyWorkflow`

### UI behavior summary

The React components are built to mirror the operational progression of the bots:

- They collect the minimum patient, location, and practitioner context required to start a case.
- They call the corresponding bots rather than implementing KHIE business logic in the UI.
- They display task status and the latest bot response.
- They support the full inpatient and ECCIF action sequences from admission or emergency intake through discharge or submission.

### Inpatient UI behavior

The inpatient UI provides:

- admission type selection,
- ward selection,
- visit creation,
- preauthorization controls,
- billing capture,
- ward transfer controls,
- discharge OTP send,
- discharge submission controls.

### ECCIF UI behavior

The ECCIF UI provides:

- identified/unidentified emergency claim creation,
- patient selection for identified cases,
- emergency metadata capture,
- doctor-consent resend,
- protocol retrieval and addition,
- patient identification for unknown cases,
- claim preview and submission.

## Current Type and Registry Surface

The bot package now exposes both canonical and compatibility aliases for the workflow contracts, so older or plan-derived names can map cleanly onto the current implementation.

Examples of the current type surface include:

- inpatient admission and transfer inputs,
- discharge and OTP inputs,
- ECCIF emergency claim input and result types,
- emergency protocol input types,
- ECCIF patient-identification inputs,
- ECCIF submit inputs,
- bot dependency injection hooks for testability.

The React package also exposes bot identifier contracts for the outpatient, inpatient, and ECCIF UIs.

## Compliance-Oriented Claims Supported by Code

The system implements several controls that are relevant to compliance-oriented healthcare workflows. These are implementation facts, not certification statements.

### 1. Access and facility scoping

- Facility identity is stored on Medplum `Location` resources.
- A KHIE workflow can only run when facility resolution produces an active, KHIE-enabled facility.
- Practitioner assignment to the resolved facility is checked before workflow execution.

Facility resolution is deterministic. It prioritizes an active encounter location, then patient location, then an explicitly selected location, followed by practitioner-role and organization defaults. An explicitly selected location can therefore be superseded by an active encounter location.

### 2. Consent and token handling

- A claim stores a KHIE consent token when the relevant KHIE authorization or emergency-claim response supplies one.
- Doctor-consent resend and downstream actions that require consent reuse the stored token.
- Once established, downstream claim progression reuses the persisted token instead of creating independent token state.

### 3. Traceable workflow state

- Workflow progression is stored in `Task` business status and inputs.
- Encounter location history is updated when a ward transfer occurs.
- Claim status is updated as the workflow progresses to completion.

### 4. Identity handling for emergency cases

- Identified and unidentified emergency flows are explicitly separated.
- Unidentified emergency claims can begin with a placeholder patient record.
- Patient identity can be reconciled later without breaking the original claim workflow.
- Submission requires a specific unknown-patient reason when the case was created as unidentified.

### 5. Clinical workflow safeguards

- Inpatient ward selection is limited to ward/bed physical types.
- Discharge for deceased patients requires next-of-kin fields.
- Inpatient and emergency flows require the expected business inputs before submission.

## What This System Does Not Claim

This implementation does not, by itself, claim the following:

- formal certification,
- legal compliance approval,
- regulator acceptance,
- production-readiness across every deployment environment,
- completeness beyond the implemented workflows in this repository.

Where compliance-related behavior is described above, it should be interpreted as code-level support for those controls, not as an external attestation.

## Validation Status

The currently implemented code paths have been validated as follows:

- editor diagnostics are clean for the touched KHIE core, bot, and React files,
- `git diff --check` passes,
- focused Vitest test commands are currently blocked in this checkout because `vitest` is not installed in the local environment.

That means the workflows are statically consistent in the editor, but runtime test execution still depends on restoring the project test dependency chain.

## Assurance Limits and Operational Dependencies

The implemented controls depend on operational configuration and surrounding Medplum platform controls. In particular:

- KHIE credentials, endpoint configuration, secrets handling, and transport security are deployment responsibilities.
- The workflow checks `PractitionerRole` facility assignment; it does not replace Medplum project-level authorization policies, audit configuration, or organizational access-governance processes.
- The UI narrows inpatient location searches to ward/bed records, but server-side transfer validation relies on the selected facility and encounter-state checks rather than independently asserting the FHIR physical type.
- Placeholder patients for unidentified ECCIF cases are active internal Patient resources. Data-retention, merge, deactivation, and privacy procedures for those records require operational policy outside these bots.
- No full runtime integration or end-to-end test execution has been completed in this checkout because the local Vitest executable is unavailable.

## Summary

The repository now contains a coherent KHIE workflow stack spanning client calls, workflow orchestration, and clinical UI. It supports outpatient, inpatient, and ECCIF emergency processing with stateful progression, traceable task updates, and explicit handling for identified and unidentified emergency cases.

The code base also expresses several meaningful compliance-oriented controls: active facility enforcement, practitioner assignment checks, consent-token reuse, explicit patient-identity branching, and workflow state traceability. Those controls are implemented in code, but they should not be presented as certified compliance claims without external validation.