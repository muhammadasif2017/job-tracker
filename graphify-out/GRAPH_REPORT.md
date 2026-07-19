# Graph Report - .  (2026-07-18)

## Corpus Check
- 7 files · ~42,682 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1172 nodes · 1833 edges · 164 communities (65 shown, 99 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 15 edges (avg confidence: 0.82)
- Token cost: 0 input · 81,749 output

## Community Hubs (Navigation)
- AuthController & OAuth Routes
- Users Module (Controller/Service/DTOs)
- Backend package.json & Jest Config
- Frontend package.json Dependencies
- ResumesController & Enrichment Trigger Endpoints
- Auth DTOs & Common Decorators
- JobsController Endpoints
- Frontend tsconfig.json
- Backend tsconfig.json
- Job Form & Type Badges (Frontend Types)
- Company Profile & Resume Upload UI
- Enrichment Controller/Service Tests
- AppModule, JwtAuthGuard & GlobalExceptionFilter
- Login/Register Pages & OAuth Button
- Job DTOs & JobsModule Wiring
- Health Module (Redis Indicator)
- Response DTOs (Attention/Company/Job)
- Storage Dual-Driver Services
- Dashboard Cards & Charts
- Auth & Refresh-Token Lifecycle (cross-layer)
- EnrichmentProcessor & LlmService
- Frontend Layout & Auth Store
- Job Create Endpoint & Enrichment Enqueue
- ResumesService & Module
- Job Detail & Kanban Pages
- Frontend Dev Dependencies
- SearchService (Tavily)
- Jobs Page & Status Badges
- Playwright E2E Fixtures
- Backend CLAUDE.md Overview
- JobQueryDto Validators
- tsconfig.build.json
- Deploy Guide (Oracle VM)
- Backend Misc Dependencies (S3, Throttler, OAuth)
- Root CLAUDE.md Overview
- Deploy Backend GitHub Actions Workflow
- WebFetchService
- Docker Compose Stack
- Backend npm Scripts
- Husky Git Hooks
- Backend Type Dependencies
- LocalStorageService & Tests
- Frontend CLAUDE.md Conventions
- lint-staged Config
- EnrichmentProcessor Test Mocks
- JobsService
- Global Route Protection Pattern (Backend + Frontend)
- LlmService Tests
- Enrichment Architecture Diagram
- Resume Storage Cleanup (cross-layer)
- nest-cli.json
- ResumesController Tests
- Root Layout & Providers
- Frontend Auth/Job Shared Types & Components
- EnrichmentController
- ResumesService Tests
- Dependabot Config
- JobStatsDto
- proxy.ts Route Guard
- PrismaModule
- StorageModule
- CurrentUser Decorator & JwtStrategy
- Prisma 7 PrismaPg Adapter
- bcrypt Dependency
- bullmq Dependency
- cheerio Dependency
- class-transformer Dependency
- class-validator Dependency
- cookie-parser Dependency
- dotenv Dependency
- groq-sdk Dependency
- helmet Dependency
- ioredis Dependency
- joi Dependency
- @nestjs/bullmq Dependency
- @nestjs/common Dependency
- @nestjs/config Dependency
- @nestjs/core Dependency
- @nestjs/jwt Dependency
- @nestjs/mapped-types Dependency
- @nestjs/passport Dependency
- nestjs-pino Dependency
- @nestjs/platform-express Dependency
- @nestjs/schedule Dependency
- @nestjs/swagger Dependency
- @nestjs/terminus Dependency
- passport Dependency
- passport-github2 Dependency
- passport-jwt Dependency
- passport-local Dependency
- pg Dependency
- pino-http Dependency
- @prisma/adapter-pg Dependency
- @prisma/client Dependency
- reflect-metadata Dependency
- swagger-ui-express Dependency
- eslint Dependency
- eslint-config-prettier Dependency
- @eslint/js Dependency
- eslint-plugin-prettier Dependency
- globals Dependency
- jest Dependency
- lint-staged Dependency
- @nestjs/cli Dependency
- @nestjs/schematics Dependency
- @nestjs/testing Dependency
- pino-pretty Dependency
- prettier Dependency
- prisma Dependency
- source-map-support Dependency
- supertest Dependency
- ts-jest Dependency
- ts-loader Dependency
- ts-node Dependency
- tsconfig-paths Dependency
- @types/bcrypt Dependency
- @types/cookie-parser Dependency
- @types/express Dependency
- @types/jest Dependency
- @types/multer Dependency
- @types/node Dependency
- @types/passport-github2 Dependency
- @types/passport-google-oauth20 Dependency
- @types/passport-jwt Dependency
- typescript Dependency
- typescript-eslint Dependency
- Next.js 16 breaking changes warning, frontend/AGENTS.md
- eslint.config.mjs, eslintConfig
- next.config.ts, nextConfig
- eslint Dependency
- eslint-config-prettier Dependency
- jsdom Dependency
- lint-staged Dependency
- prettier Dependency
- @tailwindcss/postcss Dependency
- @testing-library/jest-dom Dependency
- @testing-library/react Dependency
- @types/react Dependency
- typescript Dependency
- @vitejs/plugin-react Dependency
- postcss.config.mjs, config
- Backend E2E Tests (Live DB)
- findOne Ownership Check Pattern
- GlobalExceptionFilter
- Job Event Logging Pattern (Same-Transaction Write)
- nestjs-pino Logging
- tsBuildInfoFile Location Gotcha
- TypeScript .js Import Convention (ESM-style)
- Module
- Injectable
- Playwright E2E Tests
- providers.tsx
- React Hook Form + Zod Forms Pattern
- lib/utils.ts Utility Functions
- File Document Icon (file.svg)
- Globe Icon (globe.svg)
- Next.js Logo (SVG Wordmark)
- Vercel Logo Icon
- Window/Browser Icon (window.svg)

## God Nodes (most connected - your core abstractions)
1. `PrismaService` - 28 edges
2. `CurrentUser` - 27 edges
3. `compilerOptions` - 25 edges
4. `AuthService` - 24 edges
5. `JobQueryDto` - 20 edges
6. `cn()` - 20 edges
7. `JobsService` - 18 edges
8. `AuthController` - 16 edges
9. `CreateJobDto` - 16 edges
10. `JobsController` - 16 edges

## Surprising Connections (you probably didn't know these)
- `Prisma 7 Quirks` --semantically_similar_to--> `Key Design Notes (auth, prisma, rate limiting, logging)`  [INFERRED] [semantically similar]
  CLAUDE.md → backend/README.md
- `Frontend Routing (proxy.ts, route groups)` --semantically_similar_to--> `Routing (proxy.ts, route groups)`  [INFERRED] [semantically similar]
  CLAUDE.md → frontend/README.md
- `TanStack Query Data Fetching Conventions` --semantically_similar_to--> `Data Fetching Conventions`  [INFERRED] [semantically similar]
  CLAUDE.md → frontend/README.md
- `Backend E2E Test Setup` --semantically_similar_to--> `E2E Tests`  [INFERRED] [semantically similar]
  CLAUDE.md → backend/README.md
- `docker-compose.dev.yml — Local Dev Infra` --semantically_similar_to--> `docker-compose.yml — Full Stack`  [INFERRED] [semantically similar]
  docker-compose.dev.yml → docker-compose.yml

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **OAuth Authentication Flow (Backend + Frontend)** — backend_claude_md_oauth_flow, backend_claude_md_issuetokens, backend_claude_md_handleoauthuser, frontend_claude_md_axios_instance [INFERRED 0.85]
- **Refresh Token Lifecycle: Issue, Rotate, Revoke, Cleanup** — backend_claude_md_issuetokens, backend_claude_md_refreshtoken_table, backend_claude_md_soft_revoke_reuse_detection, backend_claude_md_cleanupexpiredrefreshtokens_cron [EXTRACTED 1.00]
- **Three-Layer Frontend Auth State Sync** — frontend_claude_md_tokenstorage, frontend_claude_md_auth_store, frontend_claude_md_jt_authed_cookie [EXTRACTED 1.00]
- **CI/CD Deployment Pipeline (build, push, SSH deploy)** — _github_workflows_deploy_test_job, _github_workflows_deploy_build_push_job, _github_workflows_deploy_deploy_job, deploy_automated_deploys, docker_compose_prod_overview [EXTRACTED 1.00]
- **Auth / OAuth / JWT Flow Documentation** — claude_auth_flow, backend_readme_key_design_notes, frontend_readme_oauth_callback [INFERRED 0.85]
- **Company Enrichment Async Pipeline** — readme_company_enrichment_client, readme_company_enrichment_api, readme_company_enrichment_queue, readme_company_enrichment_processor, readme_company_enrichment_tavily, readme_company_enrichment_groq [EXTRACTED 1.00]

## Communities (164 total, 99 thin omitted)

### Community 0 - "AuthController & OAuth Routes"
Cohesion: 0.05
Nodes (38): ApiExcludeEndpoint, Public(), AuthController, ApiBearerAuth, ApiBody, ApiConflictResponse, ApiOkResponse, ApiOperation (+30 more)

### Community 1 - "Users Module (Controller/Service/DTOs)"
Cohesion: 0.07
Nodes (33): ChangePasswordDto, ApiProperty, IsString, MaxLength, MinLength, ApiPropertyOptional, IsEmail, IsOptional (+25 more)

### Community 2 - "Backend package.json & Jest Config"
Cohesion: 0.05
Nodes (42): author, description, jest, collectCoverageFrom, coverageDirectory, moduleFileExtensions, moduleNameMapper, rootDir (+34 more)

### Community 3 - "Frontend package.json Dependencies"
Cohesion: 0.05
Nodes (41): axios, clsx, date-fns, dependencies, axios, clsx, date-fns, @hello-pangea/dnd (+33 more)

### Community 4 - "ResumesController & Enrichment Trigger Endpoints"
Cohesion: 0.08
Nodes (33): ApiAcceptedResponse, ApiConsumes, ApiForbiddenResponse, CurrentUser, ApiConflictResponse, ApiNotFoundResponse, ApiOperation, ApiParam (+25 more)

### Community 5 - "Auth DTOs & Common Decorators"
Cohesion: 0.08
Nodes (23): MessageDto, ApiProperty, AuthTokensDto, ApiProperty, CurrentUserDto, ApiProperty, ApiPropertyOptional, ExchangeCodeDto (+15 more)

### Community 6 - "JobsController Endpoints"
Cohesion: 0.14
Nodes (17): JobsController, ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags (+9 more)

### Community 7 - "Frontend tsconfig.json"
Cohesion: 0.07
Nodes (28): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+20 more)

### Community 8 - "Backend tsconfig.json"
Cohesion: 0.07
Nodes (27): compilerOptions, allowSyntheticDefaultImports, declaration, emitDecoratorMetadata, esModuleInterop, experimentalDecorators, forceConsistentCasingInFileNames, incremental (+19 more)

### Community 9 - "Job Form & Type Badges (Frontend Types)"
Cohesion: 0.13
Nodes (25): FormData, schema, BadgeProps, JobTypeBadgeProps, PriorityBadgeProps, SourceBadgeProps, AuthTokens, EnrichmentStatus (+17 more)

### Community 10 - "Company Profile & Resume Upload UI"
Cohesion: 0.13
Nodes (12): CompanyProfileCard(), Props, formatBytes(), ResumeUpload(), ResumeUploadProps, resume, api, failedQueue (+4 more)

### Community 11 - "Enrichment Controller/Service Tests"
Cohesion: 0.15
Nodes (11): mockEnrichment, mockPrisma, user, EnrichmentService, mockPrisma, mockQueue, Injectable, InjectQueue (+3 more)

### Community 12 - "AppModule, JwtAuthGuard & GlobalExceptionFilter"
Cohesion: 0.14
Nodes (10): AppModule, ociRequired, GlobalExceptionFilter, mockHost, mockResponse, JwtAuthGuard, Injectable, bootstrap() (+2 more)

### Community 13 - "Login/Register Pages & OAuth Button"
Cohesion: 0.13
Nodes (14): FormData, LoginPage(), schema, FormData, RegisterPage(), schema, OAuthButton(), OAuthButtonProps (+6 more)

### Community 14 - "Job DTOs & JobsModule Wiring"
Cohesion: 0.15
Nodes (12): EnrichmentModule, Module, JobEventDto, ApiProperty, ApiPropertyOptional, UpdateJobDto, JobsModule, Module (+4 more)

### Community 15 - "Health Module (Redis Indicator)"
Cohesion: 0.14
Nodes (12): HealthController, ApiOkResponse, ApiOperation, ApiTags, Controller, Get, HealthModule, Module (+4 more)

### Community 16 - "Response DTOs (Attention/Company/Job)"
Cohesion: 0.15
Nodes (14): ATTENTION_TYPES, AttentionItemDto, AttentionType, ApiProperty, CompanyProfileResponseDto, ApiProperty, ApiPropertyOptional, JobResponseDto (+6 more)

### Community 17 - "Storage Dual-Driver Services"
Cohesion: 0.15
Nodes (5): Inject, Inject, OracleStorageService, Injectable, IStorageService

### Community 18 - "Dashboard Cards & Charts"
Cohesion: 0.20
Nodes (12): AttentionCard(), ICON_COLORS, ICONS, MESSAGES, StatsCard(), StatsCardProps, StatusChart(), Skeleton() (+4 more)

### Community 19 - "Auth & Refresh-Token Lifecycle (cross-layer)"
Cohesion: 0.15
Nodes (17): Access Token (15min), AuthController, cleanupExpiredRefreshTokens Cron Job, BullMQ Enrichment Queue, GoogleStrategy, handleOAuthUser, issueTokens Method, JwtRefreshStrategy (+9 more)

### Community 20 - "EnrichmentProcessor & LlmService"
Cohesion: 0.15
Nodes (9): EnrichmentProcessor, JOB_BOARD_DOMAINS, Injectable, CompanyData, EXTRACT_TOOL, LlmService, sanitize(), Injectable (+1 more)

### Community 21 - "Frontend Layout & Auth Store"
Cohesion: 0.18
Nodes (9): CallbackHandler(), ProfilePage(), nav, Sidebar(), ThemeToggle(), Spinner(), AuthState, useAuthStore (+1 more)

### Community 22 - "Job Create Endpoint & Enrichment Enqueue"
Cohesion: 0.13
Nodes (13): CreateJobDto, ApiProperty, ApiPropertyOptional, IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString (+5 more)

### Community 23 - "ResumesService & Module"
Cohesion: 0.23
Nodes (6): ResumeResponseDto, ApiProperty, ResumesModule, Module, ResumesService, Injectable

### Community 24 - "Job Detail & Kanban Pages"
Cohesion: 0.17
Nodes (14): JobDetailPage(), Timeline(), DashboardPage(), JobForm(), JobFormProps, KANBAN_COLS, KanbanBoard(), KanbanBoardProps (+6 more)

### Community 25 - "Frontend Dev Dependencies"
Cohesion: 0.13
Nodes (15): eslint-config-next, devDependencies, eslint-config-next, @playwright/test, tailwindcss, @testing-library/user-event, @types/node, @types/react-dom (+7 more)

### Community 26 - "SearchService (Tavily)"
Cohesion: 0.20
Nodes (7): SearchService, mockConfigService, mockLogger, tavilyResponse, TavilyResponse, TavilyResult, Injectable

### Community 27 - "Jobs Page & Status Badges"
Cohesion: 0.23
Nodes (11): JobsPage(), useDebounce(), passwordSchema, profileSchema, JobTypeBadge(), PriorityBadge(), SourceBadge(), StatusBadge() (+3 more)

### Community 28 - "Playwright E2E Fixtures"
Cohesion: 0.38
Nodes (9): createTestJob(), createTestUser(), deleteTestJob(), deleteTestUser(), injectAuth(), TestJob, TestUser, goToJobs() (+1 more)

### Community 29 - "Backend CLAUDE.md Overview"
Cohesion: 0.17
Nodes (12): E2E Tests, Key Design Notes (auth, prisma, rate limiting, logging), Backend Module Structure, Backend README, Backend E2E Test Setup, Prisma 7 Quirks, Key API Endpoints Table, Feature List (+4 more)

### Community 30 - "JobQueryDto Validators"
Cohesion: 0.17
Nodes (12): JobQueryDto, ApiPropertyOptional, IsDateString, IsEnum, IsOptional, IsString, MaxLength, IsIn (+4 more)

### Community 31 - "tsconfig.build.json"
Cohesion: 0.17
Nodes (11): compilerOptions, rootDir, exclude, extends, node_modules, dist, generated, prisma.config.ts (+3 more)

### Community 32 - "Deploy Guide (Oracle VM)"
Cohesion: 0.18
Nodes (12): Staying $0 After Trial (Always-Free budget), Automated Deploys (GitHub Actions), Install Docker on the VM, Point DuckDNS at the VM, Open the Firewall — Both Layers gotcha, Deploy job does not git pull gotcha, Idle-Reclaim Caveat, Out of Host Capacity workaround (+4 more)

### Community 33 - "Backend Misc Dependencies (S3, Throttler, OAuth)"
Cohesion: 0.18
Nodes (11): @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, dependencies, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, @nestjs/throttler, passport-google-oauth20, rxjs (+3 more)

### Community 34 - "Root CLAUDE.md Overview"
Cohesion: 0.18
Nodes (11): Auth Flow (JWT + OAuth), Frontend Auth State — Two Layers, Behavioral Guidelines (Think Before Coding etc.), Database Schema Relationships, GlobalExceptionFilter Error Handling, React Hook Form + Zod Forms, nestjs-pino Logging, Backend Module Structure (+3 more)

### Community 35 - "Deploy Backend GitHub Actions Workflow"
Cohesion: 0.31
Nodes (10): build-push job (Docker build + GHCR push), deploy job (SSH + docker compose up), GHCR image job-tracker-backend, Deploy Backend GitHub Actions Workflow, test job (typecheck + jest), Configure and Launch (.env notes), Create the Neon Database, backend service (prod) (+2 more)

### Community 36 - "WebFetchService"
Cohesion: 0.24
Nodes (4): mockLogger, Injectable, WebFetchService, RFC-1918

### Community 37 - "Docker Compose Stack"
Cohesion: 0.29
Nodes (10): backend service, docker-compose.dev.yml — Local Dev Infra, postgres service (dev), redis service (dev), frontend service, docker-compose.yml — Full Stack, postgres service, redis service (prod) (+2 more)

### Community 38 - "Backend npm Scripts"
Cohesion: 0.20
Nodes (10): scripts, build, dev, format, format:check, lint, start, test (+2 more)

### Community 39 - "Husky Git Hooks"
Cohesion: 0.20
Nodes (9): husky, description, devDependencies, husky, name, private, scripts, prepare (+1 more)

### Community 40 - "Backend Type Dependencies"
Cohesion: 0.22
Nodes (9): devDependencies, @eslint/eslintrc, @types/passport-local, @types/pg, @types/supertest, @eslint/eslintrc, @types/passport-local, @types/pg (+1 more)

### Community 41 - "LocalStorageService & Tests"
Cohesion: 0.22
Nodes (4): LocalStorageService, mockConfig, mockFs, Injectable

### Community 42 - "Frontend CLAUDE.md Conventions"
Cohesion: 0.22
Nodes (9): TanStack Query Data Fetching Conventions, Frontend Routing (proxy.ts, route groups), API Client (lib/api.ts), Auth State — Two Layers, Data Fetching Conventions, Forms Conventions, OAuth Callback Page, Frontend README (+1 more)

### Community 43 - "lint-staged Config"
Cohesion: 0.25
Nodes (8): eslint --fix, prettier --write, lint-staged, **/*.{json,css,md}, **/*.{ts,tsx,js,jsx}, name, private, version

### Community 44 - "EnrichmentProcessor Test Mocks"
Cohesion: 0.25
Nodes (7): bullJob, dbJob, extracted, mockLlm, mockPrisma, mockSearch, mockWebFetch

### Community 46 - "Global Route Protection Pattern (Backend + Frontend)"
Cohesion: 0.29
Nodes (7): JwtAuthGuard, auth.store.ts Zustand Store, jt_authed Cookie (presence signal), Next.js 16 Breaking Changes, proxy.ts Route Guard, Sidebar Component, tokenStorage (lib/auth.ts)

### Community 47 - "LlmService Tests"
Cohesion: 0.29
Nodes (5): baseInput, mockConfigService, mockCreate, mockLogger, toolCallResponse

### Community 48 - "Enrichment Architecture Diagram"
Cohesion: 0.52
Nodes (7): NestJS API, Company Enrichment Architecture (sequence diagram), Client, Groq LLM, Enrichment Processor, BullMQ (Redis) Queue, Tavily Search

### Community 49 - "Resume Storage Cleanup (cross-layer)"
Cohesion: 0.33
Nodes (6): JobsService.remove Resume Cleanup, LocalStorageService, OracleStorageService, ResumesService.upload Storage-First Ordering, STORAGE_SERVICE Injection Token, StorageModule

### Community 50 - "nest-cli.json"
Cohesion: 0.33
Nodes (5): collection, compilerOptions, deleteOutDir, $schema, sourceRoot

### Community 51 - "ResumesController Tests"
Cohesion: 0.33
Nodes (5): mockConfig, mockFs, MockRes, mockService, user

### Community 52 - "Root Layout & Providers"
Cohesion: 0.40
Nodes (3): geist, metadata, Providers()

### Community 53 - "Frontend Auth/Job Shared Types & Components"
Cohesion: 0.33
Nodes (6): JobForm Component, JobStatus Type, KanbanBoard Component, ResumeUpload Component, TanStack Query Conventions, types/index.ts

### Community 54 - "EnrichmentController"
Cohesion: 0.40
Nodes (5): EnrichmentController, ApiBearerAuth, ApiTags, ApiUnauthorizedResponse, Controller

### Community 55 - "ResumesService Tests"
Cohesion: 0.40
Nodes (4): mockLogger, mockPrisma, mockStorage, resumeRecord

### Community 56 - "Dependabot Config"
Cohesion: 0.50
Nodes (4): Dependabot GitHub Actions updates, Dependabot npm updates for /backend, Dependabot npm updates for /frontend, Dependabot Configuration

### Community 57 - "JobStatsDto"
Cohesion: 0.67
Nodes (3): ByStatusDto, JobStatsDto, ApiProperty

### Community 58 - "proxy.ts Route Guard"
Cohesion: 0.67
Nodes (3): config, proxy(), PUBLIC_PATHS

### Community 59 - "PrismaModule"
Cohesion: 0.67
Nodes (3): PrismaModule, Global, Module

### Community 60 - "StorageModule"
Cohesion: 0.67
Nodes (3): StorageModule, Global, Module

## Knowledge Gaps
- **351 isolated node(s):** `$schema`, `collection`, `sourceRoot`, `deleteOutDir`, `mockResponse` (+346 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **99 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `JobStatus` connect `Job Form & Type Badges (Frontend Types)` to `Job Detail & Kanban Pages`, `Jobs Page & Status Badges`, `JobsController Endpoints`?**
  _High betweenness centrality (0.106) - this node is a cross-community bridge._
- **Why does `CurrentUser` connect `ResumesController & Enrichment Trigger Endpoints` to `AuthController & OAuth Routes`, `Users Module (Controller/Service/DTOs)`, `Auth DTOs & Common Decorators`, `JobsController Endpoints`, `Enrichment Controller/Service Tests`, `Job DTOs & JobsModule Wiring`, `Job Create Endpoint & Enrichment Enqueue`, `ResumesService & Module`?**
  _High betweenness centrality (0.104) - this node is a cross-community bridge._
- **Why does `JobsService` connect `JobsService` to `JobsController Endpoints`, `Enrichment Controller/Service Tests`, `Job DTOs & JobsModule Wiring`, `Job Create Endpoint & Enrichment Enqueue`, `ResumesService & Module`?**
  _High betweenness centrality (0.067) - this node is a cross-community bridge._
- **What connects `$schema`, `collection`, `sourceRoot` to the rest of the system?**
  _351 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `AuthController & OAuth Routes` be split into smaller, more focused modules?**
  _Cohesion score 0.05411392405063291 - nodes in this community are weakly interconnected._
- **Should `Users Module (Controller/Service/DTOs)` be split into smaller, more focused modules?**
  _Cohesion score 0.0653061224489796 - nodes in this community are weakly interconnected._
- **Should `Backend package.json & Jest Config` be split into smaller, more focused modules?**
  _Cohesion score 0.047619047619047616 - nodes in this community are weakly interconnected._