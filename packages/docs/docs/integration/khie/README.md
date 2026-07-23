# Medplum and KHIE Technical Architecture and Evidence

This directory contains PlantUML source for the Medplum platform architecture, supported deployment profiles, operational controls, and the implemented JaliHealth KHIE payer-workflow integration. The diagrams describe the system as implemented in this repository; deployment-specific diagrams identify alternatives rather than implying that every environment runs every component.

## Diagram Index

| Diagram | Scope | Primary Evidence |
| --- | --- | --- |
| [00-platform-technical-architecture.md](00-platform-technical-architecture.md) | Runtime components, hosting, execution, operations, and assurance boundaries | root Compose files, Dockerfiles, Helm chart, server and self-hosting docs |
| [01-system-context.puml](01-system-context.puml) | Containers, trust boundaries, and persistent FHIR resources | `jalihealth-khie-core`, `jalihealth-khie-bots`, `jalihealth-khie-react` |
| [02-facility-resolution.puml](02-facility-resolution.puml) | Facility-resolution precedence and practitioner-role authorization | `core/src/resolution.ts`, `bots/src/context.ts` |
| [03-inpatient-workflow.puml](03-inpatient-workflow.puml) | SHIF per-diem/FFS admission-to-discharge and ward transfer | `bots/src/start-shif-inpatient.ts`, `bots/src/switch-shif-inpatient-intervention.ts`, `bots/src/discharge-shif-inpatient.ts` |
| [04-eccif-emergency-workflow.puml](04-eccif-emergency-workflow.puml) | Identified/unidentified emergency claims and later identity reconciliation | `bots/src/create-eccif-emergency-claim.ts`, `bots/src/identify-eccif-emergency-patient.ts`, `bots/src/preview-and-submit-eccif-claim.ts` |
| [05-payer-case-state-model.puml](05-payer-case-state-model.puml) | Claim, Task, Encounter, Coverage, and consent-token state relationships | `bots/src/payer-case.ts`, `bots/src/eccif-case.ts` |
| [06-compliance-evidence.puml](06-compliance-evidence.puml) | Implemented controls, evidence artifacts, and operational dependencies | KHIE core and bot modules listed in the diagram |
| [07-platform-architecture.puml](07-platform-architecture.puml) | Full Medplum runtime containers, APIs, storage, agents, and integrations | `packages/server`, `packages/app`, `packages/agent`, `packages/bot-layer` |
| [08-hosting-profiles.puml](08-hosting-profiles.puml) | Host-native, Docker Compose, Kubernetes, and AWS deployment alternatives | root Compose files, Helm chart, CDK docs, deployment scripts |
| [09-delivery-and-operations.puml](09-delivery-and-operations.puml) | Build, image provenance, deployment, health, metrics, and operational lifecycle | build/deploy scripts, Dockerfiles, OpenTelemetry setup |
| [10-platform-compliance-evidence.puml](10-platform-compliance-evidence.puml) | Platform-wide technical control evidence and external governance dependencies | Helm values, Dockerfiles, self-hosting guidance, KHIE evidence |

## System Scope

The platform diagrams cover these verified architectural surfaces:

- React application delivery and reusable React workflow components.
- Node.js Medplum server, FHIR R4 API, authentication, resource processing, and binary-storage configuration.
- PostgreSQL as the primary persistence layer and Redis for caching and queueing.
- Bot execution as a configurable runtime: VM-context bots are enabled in the supplied local/full-stack configuration; cloud or Kubernetes serverless runtimes are optional deployment choices.
- Optional Medplum Agent connectivity for on-premise device and HL7 integration.
- Docker Compose, standalone containers, Kubernetes/Helm, and AWS CDK/ECS deployment routes.
- Build/release provenance, runtime health checks, and OpenTelemetry metrics integration.
- KHIE outpatient, inpatient, and ECCIF workflows as a domain integration layered on the FHIR platform.

The diagrams do not attempt to enumerate every optional package in the monorepo, every cloud-provider resource, or every Medplum product capability. They describe the verified runtime and operational surfaces relevant to deploying and operating this system.

## Scope and Evidence Standard

The diagrams distinguish three categories:

- **Implemented control**: behavior enforced or persisted by the current code.
- **Evidence artifact**: FHIR resource content, client call metadata, or workflow transition created by the implementation.
- **Operational dependency**: configuration or governance required outside the KHIE modules.

The diagrams do not assert regulatory certification, legal approval, production accreditation, or independent audit results.

## Rendering

Each `.puml` file is self-contained PlantUML source and can be rendered with a standard PlantUML-compatible renderer. Rendered images are intentionally not committed, so diagram source remains reviewable and changes can be traced with the implementation.

## Current Assurance Boundary

The platform includes hardened production container bases, non-root Kubernetes security defaults, image provenance/SBOM build options, FHIR-backed workflow state, and OpenTelemetry instrumentation. The KHIE workflow design adds facility activation and practitioner-role assignment checks, consent-token persistence after KHIE returns a token, FHIR Task/Claim progression, and ECCIF unknown-patient reconciliation. Runtime test execution is not currently evidenced in this checkout because the local Vitest executable is unavailable.