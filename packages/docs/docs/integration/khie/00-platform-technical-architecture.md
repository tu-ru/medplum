# Medplum Platform and KHIE Technical Architecture

This document records the verified system architecture in this repository: the Medplum platform runtime, hosting profiles, build and deployment lifecycle, operational dependencies, and the JaliHealth KHIE workflow extension.

It is a technical implementation record. It does not establish certification, an approved production design, or a statement that every optional component is enabled in every deployment.

## Architecture Scope

The repository is a TypeScript monorepo managed through npm workspaces and Turborepo. Its primary runtime architecture consists of:

- A React web application.
- A Node.js Medplum API server.
- PostgreSQL as the primary persistence layer.
- Redis for caching and queueing dependencies.
- Configurable binary storage.
- Server-side Bot execution.
- Optional Medplum Agent connectivity for site-local systems and devices.
- Optional external integrations, including KHIE payer workflows.

The foundational clinical and administrative data model is FHIR R4. The KHIE workflow persists its state using FHIR resources rather than a separate KHIE database schema.

## Runtime Components

| Component | Responsibility | Verified implementation evidence |
| --- | --- | --- |
| Web application | Browser-delivered clinical and administrative UI. | `packages/app`; static container uses Nginx on port `3000`. |
| API server | FHIR R4 API, authentication, resource processing, binary operations, Bot orchestration, and application services. | `packages/server`; production container exposes `5000` and `8103`. |
| PostgreSQL | Primary persistence for FHIR resources and application data. | Root Compose files use PostgreSQL 16. Kubernetes guidance requires external PostgreSQL. |
| Redis | Caching and background queueing dependency. | Root Compose files use Redis 7. Kubernetes guidance requires external Redis. |
| Binary storage | Stores Binary resource content. | Configurable in server settings; local examples use file storage and production guidance supports S3-compatible object storage. |
| Bot runtime | Executes server-side workflow logic. | VM-context Bots are enabled in supplied full-stack Docker and Helm values; cloud/serverless choices are deployment dependent. |
| Medplum Agent | Optional site-local device and HL7-oriented connectivity. | `packages/agent`; receives base URL, client credentials, and Agent ID. |
| KHIE packages | KHIE client calls, FHIR workflow Bots, and reusable React workflows. | `jalihealth-khie-core`, `jalihealth-khie-bots`, `jalihealth-khie-react`. |
| OpenTelemetry | Service metrics and instrumentation integration. | Server container starts with OpenTelemetry instrumentation. |

## Primary Flows

### Browser, API, and storage

1. Users access the React web application.
2. The application calls the Medplum API using configured API and authentication flows.
3. The API server validates and persists FHIR resources in PostgreSQL.
4. The API server uses Redis for cache and queue-backed work.
5. Binary content uses the configured binary storage provider.

### Bot execution

1. A client, FHIR event, schedule, or server operation invokes a Bot.
2. The Bot reads required FHIR context and writes results using the Medplum client.
3. The Bot may call an external system.
4. The Bot persists workflow state in FHIR resources such as `Task`, `Claim`, `Encounter`, `Coverage`, and `Patient`.

### Optional Agent connectivity

1. A site-local source system or device communicates with a deployed Agent.
2. The Agent connects to the Medplum server using configured credentials and Agent identity.
3. The Agent bridges the site-local protocol or device interaction to Medplum services.

Agent deployment is optional. The core web/API platform does not require an Agent for ordinary FHIR workflows.

## Hosting Profiles

The repository supports several alternatives. A deployment selects one profile and configures its own domains, TLS, secrets, data services, monitoring, and policy controls.

### Host-native development

Prerequisites include a supported Node.js version, npm, Docker, PostgreSQL, and Redis. The standard path is:

```sh
npm ci
npm run build:fast
docker compose up
cd packages/server && npm run dev
cd packages/app && npm run dev
```

The root Compose file provides PostgreSQL and Redis. The server normally listens on `8103`; the application development server normally listens on `3000`. The server health endpoint is `http://localhost:8103/healthcheck`.

### Full-stack Docker Compose

`docker-compose.full-stack.yml` provides a four-container local stack:

| Container | Default port | Purpose |
| --- | --- | --- |
| `postgres` | `5432` | PostgreSQL 16 with a persistent Docker volume. |
| `redis` | `6379` | Redis 7 with password configuration. |
| `medplum-server` | `8103` | Node.js API server and local Bot runtime configuration. |
| `medplum-app` | `3000` | Static React application served by Nginx. |

The supplied configuration is for local evaluation. Production deployment must supply environment-specific domains, allowed origins, secrets, identity providers, binary storage, data durability, monitoring, and security controls.

### Kubernetes and Helm

The Helm chart deploys the Medplum server into a Kubernetes namespace. Production guidance expects separately provisioned PostgreSQL and Redis, plus S3-compatible binary storage when required.

Verified Helm defaults include:

- configurable image, replica count, autoscaling, ingress, sidecars, and pod disruption budget;
- non-root pod and container user `65532`;
- read-only root filesystem;
- disabled privilege escalation;
- all Linux capabilities dropped;
- RuntimeDefault seccomp profile.

Production values must override database and Redis endpoints, public URLs, origins, signing keys, storage, secret source, ingress domain, and other environment-specific settings.

### AWS CDK and ECS deployment route

The documented AWS route uses AWS CDK with components including load balancing, ECS/Fargate server services, Aurora PostgreSQL, ElastiCache Redis, S3, CloudFront, Route 53, IAM, Secrets Manager, Parameter Store, CloudWatch, SES, and optionally WAF.

The ECS deployment script registers a task-definition revision with a specific immutable server image digest. It can also update an optional worker service. AWS resource topology, IAM policy, TLS, backup policy, and monitoring remain deployment responsibilities.

## Build, Delivery, and Operations

| Command | Purpose |
| --- | --- |
| `npm run build` | Builds primary packages excluding documentation and examples. |
| `npm run build:all` | Builds all packages. |
| `npm run build:fast` | Builds the application and server slice for local development. |
| `npm test` | Runs Turborepo test tasks when dependencies are installed. |
| `npm run build:docs` | Builds the documentation package. |

Server and application image scripts use Docker Buildx for `linux/amd64` and `linux/arm64` images and request provenance and SBOM attestations. Server images use hardened Node base images. The application image uses an unprivileged Nginx base image and runs as a non-root user.

The server health endpoint checks service readiness in local guidance. The server also exposes OpenTelemetry instrumentation; collector and observability backend selection are deployment decisions.

Self-hosting guidance recommends monitoring application CPU, memory, disk, and network; PostgreSQL capacity and replication; Redis memory and evictions; and load-balancer error/latency signals. It additionally recommends centralized logging, tracing, tested backups, documented RTO/RPO, private backend networks, managed secrets, rotation, and patching.

## KHIE Domain Integration

The KHIE integration is layered on the Medplum platform:

| Package | Responsibility |
| --- | --- |
| `@medplum/jalihealth-khie-core` | KHIE client calls, OAuth token caching, facility resolution, facility headers, configuration, and errors. |
| `@medplum/jalihealth-khie-bots` | Outpatient, inpatient, and ECCIF orchestration with FHIR state transitions. |
| `@medplum/jalihealth-khie-react` | Reusable React workflows for outpatient, inpatient, and ECCIF emergency claims. |

### Facility control

KHIE identity and integration profile are stored on FHIR `Location` resources. Workflow context resolves an active facility in this order:

1. Active encounter location.
2. Patient location.
3. Explicit selected location.
4. Practitioner-role default location.
5. One active organization default location.

The resolved facility must be enabled and active, and the practitioner role must be assigned to it. In multitenant-header mode, the client sends the resolved facility code and identifier type in KHIE request headers.

### Implemented payer workflows

- Outpatient: UHC capitation and SHIF fee-for-service case initiation, eligibility, contacts, OTP, visit creation, preauthorization, billing, preview, and submission.
- Inpatient: SHIF per-diem and FFS admission, preauthorization, billing, ward transfer, discharge OTP, and discharge submission.
- ECCIF: identified and unidentified emergency creation, doctor-consent resend, protocol retrieval/addition, patient reconciliation, preview, and submission.

Inpatient ward searches use FHIR physical types `wa` (ward) and `bd` (bed). The transfer Bot updates `Encounter.location` history and the persisted intervention code only after the KHIE switch succeeds. ECCIF unknown cases create a placeholder Patient, preserve the original emergency consent token, and require an unknown-patient reason when submitted without later identification.

## Technical Compliance Evidence

| Control area | Code-level evidence |
| --- | --- |
| Workflow traceability | FHIR Claim/Task workflow status, Encounter location history, Coverage relationships. |
| Facility scoping | Location-based KHIE identity, active status checks, resolution precedence, PractitionerRole assignment validation. |
| Consent workflow | Persistence and reuse of KHIE authorization or emergency tokens supplied by KHIE. |
| Clinical guards | OTP or biometric discharge authorization, deceased-patient next-of-kin fields, billing-before-discharge, unknown-patient reason requirement. |
| Workload isolation | Kubernetes non-root execution, read-only root filesystem, dropped capabilities, seccomp configuration. |
| Supply-chain traceability | Buildx image process with requested SBOM and provenance attestations. |
| Operational visibility | Health endpoint, OpenTelemetry instrumentation, and documented monitoring practices. |

## Assurance Boundaries

The following must be established or audited per deployment and are outside the guarantees of these modules:

- identity-provider configuration, user provisioning, access review, and project authorization policy;
- TLS, domain, network segmentation, firewall, and ingress configuration;
- secret storage, rotation, backup, disaster recovery, RTO/RPO, and retention;
- log retention, audit review, incident response, privacy policy, and data lifecycle;
- vulnerability management, dependency patching, release approval, external assessment, and certification;
- runtime execution of the newly added KHIE workflow tests, which remains unavailable in this checkout because the local Vitest executable is absent.

## PlantUML Source

The accompanying PlantUML diagrams are in this directory:

- `01-system-context.puml` through `06-compliance-evidence.puml`: KHIE integration architecture and evidence.
- `07-platform-architecture.puml`: complete runtime topology.
- `08-hosting-profiles.puml`: host-native, Compose, Kubernetes, and AWS alternatives.
- `09-delivery-and-operations.puml`: build, delivery, health, and telemetry lifecycle.
- `10-platform-compliance-evidence.puml`: platform-wide controls, evidence, and external dependencies.