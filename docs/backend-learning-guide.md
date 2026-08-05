# Backend Deep-Dive Learning Guide — Job Tracker (NestJS)

> Personal study notes. Gitignored. Not for the repo.
> Goal: understand every line and design decision well enough to defend it in any interview.

**Key sources used throughout:**
- NestJS docs: https://docs.nestjs.com
- Passport.js docs: https://www.passportjs.org/concepts/authentication
- JWT spec (RFC 7519): https://datatracker.ietf.org/doc/html/rfc7519
- OAuth 2.0 (RFC 6749): https://datatracker.ietf.org/doc/html/rfc6749
- Prisma docs: https://www.prisma.io/docs
- BullMQ docs: https://docs.bullmq.io
- TypeScript Decorators: https://www.typescriptlang.org/docs/handbook/decorators.html
- reflect-metadata spec: https://rbuckton.github.io/reflect-metadata
- OWASP Top 10: https://owasp.org/www-project-top-ten
- pino logger: https://getpino.io
- Helmet.js: https://helmetjs.github.io
- class-validator: https://github.com/typestack/class-validator
- bcrypt: https://en.wikipedia.org/wiki/Bcrypt

---

## Table of Contents

1. [NestJS Core Internals](#1-nestjs-core-internals)
2. [Bootstrap — `main.ts`](#2-bootstrap--maints)
3. [Root Module — `app.module.ts`](#3-root-module--appmodulets)
4. [Prisma Layer](#4-prisma-layer)
5. [Auth System — Full Deep Dive](#5-auth-system--full-deep-dive)
6. [Common Layer](#6-common-layer)
7. [Jobs Module](#7-jobs-module)
8. [Storage Module](#8-storage-module)
9. [Enrichment Module — BullMQ & LLM](#9-enrichment-module--bullmq--llm)
10. [Resumes Module](#10-resumes-module)
11. [Users Module](#11-users-module)
12. [DTOs & Validation Pipeline](#12-dtos--validation-pipeline)
13. [Security Patterns Reference](#13-security-patterns-reference)
14. [Interview Q&A](#14-interview-qa)

---

## 1. NestJS Core Internals

> Source: https://docs.nestjs.com/fundamentals/custom-providers
> Source: https://docs.nestjs.com/fundamentals/lifecycle-events

### 1.1 What NestJS Actually Is

NestJS is an **application framework** layered on top of Express (default) or Fastify. Express itself is minimal: it gives you routing and middleware. NestJS adds:

- An **IoC container** (Inversion of Control / Dependency Injection)
- A **module system** that organizes providers into compilation units
- **Decorators** as the configuration API
- A **lifecycle hooks** system (`OnModuleInit`, `OnModuleDestroy`, etc.)
- First-class primitives: Guards, Pipes, Interceptors, Exception Filters

Under the hood, `NestFactory.create(AppModule)` does:

```
1. Read @Module() metadata from AppModule (via Reflect.getMetadata)
2. Recursively read all imported modules — build a dependency graph
3. Topological sort of providers (dependencies instantiated before dependents)
4. Instantiate every provider in order — inject already-instantiated deps
5. Bind controllers to Express routes (register method handlers)
6. Call OnModuleInit on every provider that implements it
7. Return the app object
```

### 1.2 Dependency Injection — How It Actually Works

**The problem without DI:**

```ts
class AuthService {
  private prisma = new PrismaService();   // hard dependency
  private jwt   = new JwtService();       // impossible to swap in tests
}
```

`AuthService` owns the lifecycle of its deps. You can't test `AuthService` with a mock `PrismaService` without modifying the source.

**DI flips the responsibility:**

```ts
class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}
}
```

`AuthService` declares what it needs. The container builds them and injects them.

**How NestJS knows what to inject — `reflect-metadata`:**

> Source: https://rbuckton.github.io/reflect-metadata/
> Source: https://www.typescriptlang.org/tsconfig#emitDecoratorMetadata

`tsconfig.json` has `"emitDecoratorMetadata": true`. This makes TypeScript emit extra metadata at each decorated class. The `reflect-metadata` polyfill stores it in a `WeakMap`. NestJS reads it:

```ts
// TypeScript emits this automatically for decorated classes:
Reflect.defineMetadata(
  'design:paramtypes',
  [PrismaService, JwtService, ConfigService],
  AuthService
);

// NestJS reads it at startup:
const deps = Reflect.getMetadata('design:paramtypes', AuthService);
// → [PrismaService, JwtService, ConfigService]
// Then looks each up in the container and injects them.
```

This is why `@Injectable()` must be on every service — it triggers the decorator machinery that causes TypeScript to emit the metadata.

**Without `@Injectable()` on a provider**, TypeScript doesn't emit `design:paramtypes` for it, and NestJS can't resolve its constructor arguments → "Nest can't resolve dependencies" error.

**Provider scopes:**

> Source: https://docs.nestjs.com/fundamentals/injection-scopes

| Scope | Behavior | Instance count |
|-------|----------|----------------|
| `DEFAULT` (Singleton) | One instance for the entire app lifetime | 1 |
| `REQUEST` | New instance per incoming HTTP request | 1 per request |
| `TRANSIENT` | New instance every time it's injected | N per dep |

All providers in this codebase are singletons (default). `PrismaService` is created once and reused — connection pooling lives inside the `pg` driver, not by creating multiple Prisma clients.

`REQUEST` scope is useful for per-request state (e.g., a logger that includes request ID). But it forces every provider that depends on a REQUEST-scoped service to also be REQUEST-scoped — a "scope bubble" that cascades up. Avoid unless necessary.

### 1.3 Module System — Compilation & Encapsulation

> Source: https://docs.nestjs.com/modules

```ts
@Module({
  imports:     [],   // modules whose exports you want available here
  providers:   [],   // services/guards/strategies — managed by DI
  controllers: [],   // route handler classes
  exports:     [],   // subset of providers others can use
})
```

**Encapsulation:** A provider in `AuthModule` is NOT available in `JobsModule` unless `AuthModule` exports it and `JobsModule` imports `AuthModule`. This enforces explicit dependency declaration.

**`@Global()` breaks encapsulation on purpose:**

```ts
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

Once `PrismaModule` is in `AppModule.imports`, `PrismaService` is available everywhere without each module re-importing it. Used only for truly cross-cutting infrastructure (DB, Config, Logger, Storage). Avoid for domain modules — it hides who depends on what.

**Module compilation order (topological sort):**

```
PrismaModule (no deps) ──────────────────────┐
ConfigModule (no deps) ──────────────────────┤
ThrottlerModule (no deps) ───────────────────┤
BullModule (depends on parseRedisConnection) ─┤
PassportModule (no deps) ────────────────────┤─→ AuthModule
JwtModule (no deps) ─────────────────────────┤
                                              ↓
                                          AppModule (all of the above)
```

### 1.4 TypeScript Decorators — Mechanics

> Source: https://www.typescriptlang.org/docs/handbook/decorators.html

A decorator is a **function** that receives the thing it decorates. Four types:

**Class decorator:**
```ts
function Injectable(): ClassDecorator {
  return (target: Function) => {
    Reflect.defineMetadata('injectable', true, target);
  };
}
@Injectable()
class MyService {}
// At runtime: Injectable()(MyService)
```

**Method decorator:**
```ts
function Get(path: string): MethodDecorator {
  return (target, key, descriptor) => {
    Reflect.defineMetadata('route:method', 'GET', target, key);
    Reflect.defineMetadata('route:path', path, target, key);
  };
}
@Get(':id')
findOne() {}
// At runtime: Get(':id')(prototype, 'findOne', descriptor)
```

**Parameter decorator:**
```ts
function Body(): ParameterDecorator {
  return (target, key, paramIndex) => {
    Reflect.defineMetadata('route:params:body', paramIndex, target, key);
  };
}
findOne(@Body() dto: CreateJobDto) {}
// At runtime: Body()(prototype, 'findOne', 0)
```

NestJS reads all this metadata when wiring the Express router. `@Get(':id')` on a method + `@Param('id')` on a parameter → when `GET /jobs/:id` arrives, NestJS extracts `:id`, validates it through any pipes, and injects it as that parameter.

**Decorator evaluation order (important for parameter decorators):**

```ts
findOne(
  @CurrentUser() user,   // evaluated second (index 0)
  @Param('id') id,       // evaluated first (index 1)
)
// Parameter decorators: right-to-left (innermost/last index first)
// But since each independently attaches metadata, order doesn't matter in practice.
```

### 1.5 The Full Request Lifecycle

> Source: https://docs.nestjs.com/faq/request-lifecycle

```
Incoming HTTP Request
        │
        ▼
┌─────────────────────────────────┐
│     Express Middleware          │  helmet(), cors(), pino-http
│  (app.use — runs before NestJS) │
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│     Route Matching              │  Express finds matching controller
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│   Global Guards                 │  ThrottlerGuard → rate limit check
│   (registered via APP_GUARD     │  JwtAuthGuard  → token validation
│    or useGlobalGuards)          │
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│   Controller Guards             │  @UseGuards(AuthGuard('local'))
│   (on the class or method)      │  (login route only)
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│   Global Interceptors           │  (none in this app)
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│   Global Pipes                  │  ValidationPipe — transforms+validates DTO
│   Controller/Method Pipes       │  ParseIntPipe on @Query('page')
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│   Route Handler                 │  your controller method runs
└─────────────────────────────────┘
        │
        ▼ (or exception thrown anywhere above)
┌─────────────────────────────────┐
│   Exception Filters             │  GlobalExceptionFilter
│   (catch everything)            │
└─────────────────────────────────┘
        │
        ▼
    HTTP Response
```

If a guard returns `false` (or throws), everything below it in the chain is skipped. The exception filter still runs to produce a proper HTTP error response.

### 1.6 Guards vs Middleware — Why Auth Is a Guard

> Source: https://docs.nestjs.com/guards

| | Middleware | Guard |
|-|------------|-------|
| Access to route metadata (`@Public()`) | ❌ No — runs before route matching | ✅ Yes — `Reflector` reads decorator metadata |
| Can inject NestJS providers | ❌ No — registered before DI | ✅ Yes — DI-managed |
| Return type | Calls `next()` | Returns `boolean \| Observable<boolean>` |
| When it runs | Before NestJS routing | After routing, before pipes |
| Error handling | Manual Express response | Throws NestJS exception → filter handles it |

Auth must be a guard (not middleware) because it needs `Reflector` to check `@Public()` metadata. Middleware doesn't have access to route metadata — it runs before NestJS even knows which controller will handle the request.

### 1.7 `ExecutionContext` — The Transport Abstraction

> Source: https://docs.nestjs.com/fundamentals/execution-context

```ts
canActivate(context: ExecutionContext): boolean {
  // NestJS supports HTTP, WebSockets, gRPC — context abstracts all three
  const request = context.switchToHttp().getRequest<Request>();

  // Read decorator metadata:
  const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
    context.getHandler(),  // the method function object
    context.getClass(),    // the controller class
  ]);
}
```

`getAllAndOverride(key, [handler, class])` — returns the first defined value. Method-level metadata takes precedence over class-level. If `@Public()` is on the class, all methods are public. If on a specific method, only that method.

**Why `getAllAndOverride` and not `get`?** `getAllAndOverride` checks multiple targets in priority order. `get` only checks one. The two-target array `[handler, class]` implements "method overrides class" inheritance.

---

## 2. Bootstrap — `main.ts`

### 2.1 `NestFactory.create` and `bufferLogs`

```ts
const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
```

`bufferLogs: true` — during the module compilation phase (provider instantiation, route binding), NestJS emits startup log messages. Without buffering, these go to the default `ConsoleLogger` before pino takes over. With buffering, they're held in memory and flushed through pino when `useLogger` is called. This ensures **all** logs — including startup — go through pino in JSON format.

`app.get(Logger)` — pulls the `nestjs-pino` Logger instance from the DI container. `app.get()` is a direct container lookup (bypasses module encapsulation). Use only in bootstrap code.

### 2.2 Helmet — HTTP Security Headers

> Source: https://helmetjs.github.io/
> Source: https://owasp.org/www-project-secure-headers/

```ts
app.use(helmet());
```

Helmet sets these response headers:

| Header | Value | Protects against |
|--------|-------|-----------------|
| `Content-Security-Policy` | restricts script/style/img sources | XSS, data injection |
| `X-Content-Type-Options` | `nosniff` | MIME sniffing (browser guessing wrong content type) |
| `X-Frame-Options` | `SAMEORIGIN` | Clickjacking (embedding page in iframe) |
| `Strict-Transport-Security` | `max-age=15552000` | SSL stripping, downgrade attacks |
| `X-XSS-Protection` | `0` (disabled — modern browsers handle it) | Legacy XSS filter |
| `Referrer-Policy` | `no-referrer` | Leaking URL info to third parties |
| `Cross-Origin-Opener-Policy` | `same-origin` | Cross-origin window access |
| `Origin-Agent-Cluster` | `?1` | Enables origin keying for process isolation |

For a pure JSON API (no HTML served), most of these have minimal impact. But they're zero-cost to include, and any endpoint that accidentally renders HTML (error pages, Swagger UI in dev) is protected.

**MIME sniffing attack (what `nosniff` prevents):** Without this header, some browsers try to "sniff" the content type by reading the response body. If you upload a file named `evil.jpg` that contains `<script>alert(1)</script>`, an old browser might execute it as HTML. `nosniff` disables this guessing — the browser trusts the declared `Content-Type` only.

**Clickjacking (what `X-Frame-Options` prevents):** An attacker embeds your page in an invisible iframe on their site and tricks users into clicking (e.g., "You won a prize!" overlaid on top of your "Delete account" button). `SAMEORIGIN` prevents your page from being iframed by a different origin.

### 2.3 CORS — Cross-Origin Resource Sharing

> Source: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
> Source: https://fetch.spec.whatwg.org/#cors-protocol

```ts
app.enableCors({
  origin: config.get<string>('FRONTEND_URL'),
  credentials: true,
});
```

**Why browsers enforce Same-Origin Policy (SOP):** JavaScript at `https://evil.com` shouldn't be able to make authenticated requests to `https://yourapi.com` on behalf of the user (who is logged into your API). SOP prevents this by default.

**CORS is the mechanism for the server to relax SOP for trusted origins:**

```
Browser at https://app.com wants to call https://api.com/jobs

1. Browser sends preflight:
   OPTIONS /jobs HTTP/1.1
   Origin: https://app.com
   Access-Control-Request-Method: GET
   Access-Control-Request-Headers: authorization

2. Server responds:
   Access-Control-Allow-Origin: https://app.com
   Access-Control-Allow-Methods: GET, POST, PATCH, DELETE
   Access-Control-Allow-Headers: authorization, content-type
   Access-Control-Allow-Credentials: true

3. Browser sees app.com is allowed → sends the actual request
```

`credentials: true` — required to allow the `Authorization` header in cross-origin requests. Without it, the browser strips `Authorization` from cross-origin calls regardless of `Allow-Origin`. The browser also requires `Allow-Origin` to be a specific origin (not `*`) when `credentials: true`.

**Why not `origin: '*'`?** The fetch spec explicitly prohibits `Access-Control-Allow-Credentials: true` when `Access-Control-Allow-Origin: *`. If you try, the browser rejects the response. Also: wildcard allows any website to make authenticated calls to your API on behalf of your users.

### 2.4 `ValidationPipe` — Three Critical Options

> Source: https://docs.nestjs.com/pipes#class-validator
> Source: https://github.com/typestack/class-validator

```ts
new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true })
```

**`transform: true` — what actually happens:**

Without `transform`, NestJS passes a plain JavaScript object (raw JSON parsed by Express's `body-parser`) to your handler. The object is `{ company: "Acme", status: "APPLIED" }`. It's NOT an instance of `CreateJobDto`. This means:

1. `class-validator` decorators don't fire (they require class instances)
2. Type coercion doesn't happen (`"10"` stays a string, not a number)

With `transform: true`, NestJS uses `class-transformer` to:
```ts
const dto = plainToInstance(CreateJobDto, requestBody);
// Creates: new CreateJobDto() with properties assigned
// Now class-validator can iterate over the class metadata
```

**`whitelist: true` — mass assignment protection:**

```ts
class UpdateUserDto {
  @IsOptional() @IsString() name?: string;
  // 'isAdmin' is NOT declared
}

// Request body: { "name": "Alice", "isAdmin": true }
// After whitelist: { "name": "Alice" }
// 'isAdmin' stripped — Prisma never sees it
```

Prisma would throw a P2009 error on unknown fields anyway, but relying on that for security is fragile. The DTO is the explicit allowlist.

**`forbidNonWhitelisted: true` — fail loudly:**

Without it: `{ name: "Alice", isAdmin: true }` → silently becomes `{ name: "Alice" }`. The client never knows `isAdmin` was ignored, which hides bugs in client code.

With it: 400 Bad Request with "property isAdmin should not exist". The client knows their request is wrong.

### 2.5 `useGlobalGuards` vs `APP_GUARD`

```ts
// In main.ts:
app.useGlobalGuards(new JwtAuthGuard(app.get(Reflector)));

// In app.module.ts:
providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }]
```

**`useGlobalGuards`** — registers outside the module system. The DI container doesn't manage these instances. You construct them manually. `app.get(Reflector)` pulls `Reflector` from the container and passes it yourself.

**`APP_GUARD` token** — registers through the module system. DI manages the instance. Dependencies injected automatically. `ThrottlerGuard` needs `ThrottlerStorage` injected; using `APP_GUARD` lets the container handle it.

Rule of thumb: use `APP_GUARD` when the guard has injected dependencies. Use `useGlobalGuards` when you need to manually wire deps (rare) or register from bootstrap code.

Both approaches protect every route. The only practical difference is DI availability.

### 2.6 Swagger — Dev Only

```ts
if (config.get('NODE_ENV') !== 'production') {
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Job Tracker API')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);
}
```

Swagger reads NestJS controller metadata (route paths, method decorators, DTO properties) and generates an OpenAPI spec. In production:
- Exposing the API schema helps attackers understand your surface area
- The spec generation itself is not cheap (iterates all route metadata)

`addBearerAuth()` adds a UI field for entering a JWT so you can test protected routes from the Swagger UI.

---

## 3. Root Module — `app.module.ts`

### 3.1 `ConfigModule` and Joi Validation

> Source: https://docs.nestjs.com/techniques/configuration
> Source: https://joi.dev/api/

```ts
ConfigModule.forRoot({
  isGlobal: true,
  validationSchema: Joi.object({ ... }),
})
```

**Fail-fast principle:** Config validation at startup ensures you discover missing env vars immediately when deploying, not at 3am when a feature is first used.

**`forRoot` static method pattern:** This is a NestJS convention. `forRoot` returns a `DynamicModule` — a module object built at runtime (not compile time). It can accept configuration and wire providers accordingly. The `ConfigModule` you import is different each time (it has your schema baked in).

**Joi schema mechanics:**

```ts
Joi.string().required()       // must exist and be non-empty string
Joi.string().min(32)          // length constraint — JWT needs ≥32 chars for HMAC strength
Joi.number().default(3001)    // optional; if absent, use 3001
Joi.string().valid('a','b')   // enum constraint
```

**`Joi.when` — conditional validation:**

```ts
const ociRequired = Joi.when('STORAGE_DRIVER', {
  is: 'oracle',
  then: Joi.string().required(),
  otherwise: Joi.string().optional(),
});
// Used as: OCI_NAMESPACE: ociRequired
```

`Joi.when(field, { is: value, then: schema, otherwise: schema })` — dynamic schema based on a sibling field's value. OCI credentials are only validated when `STORAGE_DRIVER=oracle`. Running locally with `STORAGE_DRIVER=local` (the default), you don't need any OCI env vars. Joi validates the whole object holistically, so cross-field conditions work.

**Why 32-char minimum for JWT secrets?**

> Source: https://datatracker.ietf.org/doc/html/rfc7518#section-3.2

HS256 uses HMAC-SHA256. The security level of HMAC depends on both the hash function (SHA256 = 256-bit output) and the key length. RFC 7518 §3.2 states: "A key of the same size as the hash output or larger MUST be used." SHA256 output = 256 bits = 32 bytes. Keys shorter than 32 chars provide fewer than 256 bits of security, weakening the HMAC.

### 3.2 Rate Limiting — ThrottlerModule

> Source: https://docs.nestjs.com/security/rate-limiting
> Source: https://github.com/nestjs/throttler

```ts
ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])
```

**How it works internally:**

1. `ThrottlerGuard.canActivate()` fires for every request (via `APP_GUARD`)
2. Generates a storage key: `hash(IP + routePath + requestMethod)` (configurable)
3. Increments a counter in `ThrottlerStorage` (in-memory by default, Redis-backed in production)
4. If counter > `limit` within `ttl` window: throw `ThrottlerException` → 429 Too Many Requests
5. Sets response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`

**Why an array `[{ ttl, limit }]`?**

Multiple throttle tiers simultaneously: `[{ ttl: 60000, limit: 10 }, { ttl: 3600000, limit: 100 }]` means "max 10/minute AND max 100/hour". All tiers are checked; any exceeded → 429.

**Route-level override:**

```ts
@Throttle({ default: { ttl: 60000, limit: process.env.NODE_ENV === 'production' ? 10 : 100 } })
@Post('login')
```

`@Throttle` sets metadata that `ThrottlerGuard` reads (same `Reflector` pattern as `@Public()`). The global config's `default` key is overridden by the route-level `default` key. Auth endpoints get 10 req/min in prod — makes brute-force attacks take 6 minutes per 10 attempts (and account lockout/detection can layer on top).

### 3.3 BullMQ — Redis Queue Setup

> Source: https://docs.bullmq.io/guide/connections
> Source: https://github.com/redis/ioredis#readme

```ts
BullModule.forRoot({ connection: parseRedisConnection() })

function parseRedisConnection() {
  const u = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    maxRetriesPerRequest: null,
  };
}
```

**Why parse manually?**

BullMQ accepts an `ioredis` options object, not a URL string. `ioredis` can parse URLs via `new Redis(url)`, but BullMQ's `forRoot` doesn't expose that path directly. Manual parsing gives full control and clarity.

**`decodeURIComponent(u.password)`:**

`new URL('redis://:p%40ssword@host:6379')` → `u.password = 'p%40ssword'` (still percent-encoded). `decodeURIComponent` → `'p@ssword'`. Without decoding, ioredis sends the encoded string as the password, authentication fails.

**`maxRetriesPerRequest: null`:**

> Source: https://github.com/redis/ioredis#auto-reconnect
> Source: https://docs.bullmq.io/guide/connections#maxretriesperrequest

ioredis has a `maxRetriesPerRequest` option (default: 3). For regular Redis commands, if the command fails 3 times it rejects the promise. BullMQ uses **blocking commands** (`BLMOVE`, `BRPOPLPUSH`) that wait indefinitely for data. With a retry limit, these throw "Max retries per request limit exceeded" after 3 attempts, even though no error occurred — they were just waiting.

`null` disables the limit. BullMQ workers can now wait indefinitely for jobs without false failures.

### 3.4 Structured Logging with nestjs-pino

> Source: https://getpino.io/#/docs/api
> Source: https://github.com/iamolegga/nestjs-pino

```ts
LoggerModule.forRoot({
  pinoHttp: {
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { singleLine: true } }
      : undefined,
    autoLogging: true,
    redact: [ 'req.headers.authorization', 'req.body.password', ... ],
  },
})
```

**Why pino over NestJS's default `ConsoleLogger`?**

> Source: https://getpino.io/#/docs/benchmarks

- **Performance:** pino uses a write stream + async serialization. Benchmarks show ~5x faster than Winston, ~8x faster than Bunyan. At 1000 req/s, slow logging becomes a bottleneck.
- **Structured JSON:** Every log is `{ level, time, req, res, responseTime, msg }`. Log aggregators (Datadog, Loki, CloudWatch Logs Insights) can query structured fields directly.
- **`reqId` correlation:** pino-http auto-assigns a unique ID to each request and attaches it to every log emitted during that request. You can filter all logs for a single request by `reqId`.

**Log redaction — how `fast-redact` works:**

> Source: https://github.com/davidmarkclements/fast-redact

`redact` takes an array of dot-notation paths. pino compiles these into a redaction function using `fast-redact`. At serialization time:

```
Log object: { req: { headers: { authorization: 'Bearer eyJ...' } } }
After redaction: { req: { headers: { authorization: '[Redacted]' } } }
```

Redaction happens at the serialization layer — the original request object is NOT mutated. No side effects. The token never reaches stdout.

**Why redact `req.body.refreshToken`?**

If pino logs request bodies (which pino-http can optionally do) and a refresh request is logged, the raw refresh token would appear. An attacker with read access to log storage could replay it within 7 days.

**`singleLine: true` in pino-pretty:**

Default pino-pretty output spans multiple lines per log entry. `singleLine` compresses each to one line. Easier to `grep`, easier to read in a terminal scrolling quickly.

---

## 4. Prisma Layer

> Source: https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/driver-adapters
> Source: https://www.prisma.io/docs/orm/reference/prisma-client-reference

### 4.1 Prisma 7 Architecture — The Driver Adapter

**Pre-Prisma 7:** The datasource block wired everything:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")   // ← connection here
}
```

Prisma internally hardcoded the `pg` Node.js driver. No way to swap drivers.

**Prisma 7:** Datasource block has no `url`:

```prisma
datasource db {
  provider = "postgresql"
  // no url field
}
```

Connection wired at runtime via adapter:

```ts
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
super({ adapter });
```

**`PrismaPg` internals:**

> Source: https://www.prisma.io/docs/orm/overview/databases/postgresql#using-the-node-postgres-driver

`PrismaPg` wraps `pg` (node-postgres). It implements Prisma's `DriverAdapter` interface:

```ts
interface DriverAdapter {
  queryRaw(query: Query): Promise<Result>
  executeRaw(query: Query): Promise<number>
  startTransaction(): Promise<Transaction>
}
```

`PrismaClient` calls these methods. It doesn't know `pg` exists. You could swap to `@prisma/adapter-neon` (Neon serverless), `@prisma/adapter-d1` (Cloudflare D1), or any compatible adapter — without changing any application code.

**Why this matters for interviews:** "How would you migrate this from PostgreSQL to a serverless DB?" Answer: swap the adapter. The Prisma schema, service code, and queries stay identical.

**`prisma.config.ts` — what it is:**

```ts
// backend/prisma.config.ts
import { defineConfig } from 'prisma/config'
import 'dotenv/config'

export default defineConfig({
  earlyAccess: true,
  schema: { ... },
})
```

The Prisma CLI reads this for `prisma migrate dev`, `prisma generate`, `prisma studio`. It's separate from runtime — the CLI has its own connection setup for running migrations. Your `PrismaService` runtime adapter and the CLI config are two independent connection paths.

### 4.2 `PrismaService` Lifecycle Hooks

> Source: https://docs.nestjs.com/fundamentals/lifecycle-events
> Source: https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections

```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    super({ adapter });
  }

  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
```

**NestJS lifecycle sequence:**

```
Module compiled → Providers instantiated (constructors called)
               → onModuleInit() called on each provider
               → App starts listening
               [SIGTERM received]
               → onModuleDestroy() called on each provider
               → Process exits
```

**Why `$connect()` in `onModuleInit` and not the constructor?**

`PrismaClient` is lazy — it doesn't open connections until the first query. `$connect()` explicitly opens connections early (connection pool warm-up). This ensures the first real request isn't slowed by connection setup.

Doing it in the constructor is fine for this app (PrismaService has no deps), but `onModuleInit` is the NestJS-correct pattern for async initialization. Constructors should be synchronous.

**Why `$disconnect()` in `onModuleDestroy`?**

PostgreSQL has a max connections limit (default 100 on `pg`). When Node.js exits without disconnecting:
1. `pg` sockets close via OS cleanup eventually
2. But PostgreSQL sees abrupt disconnects — `pg_stat_activity` shows idle connections that haven't been returned
3. On rapid restarts (Kubernetes, PM2), you can exhaust connection slots

`$disconnect()` sends proper disconnection messages, closes pool connections cleanly, and waits for in-flight queries to finish before disconnecting. PostgreSQL sees a clean client departure.

### 4.3 `@Global()` PrismaModule — Trade-offs

```ts
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

**With `@Global()`:** Import `PrismaModule` once in `AppModule`. Every other module can use `PrismaService` without importing `PrismaModule`.

**Without `@Global()`:** Every module that needs DB access imports `PrismaModule`:
```ts
// AuthModule, JobsModule, UsersModule, ResumesModule, EnrichmentModule all need:
imports: [PrismaModule]
```
5+ redundant imports. Not wrong, just verbose for a truly cross-cutting service.

**The trade-off:** `@Global()` hides the dependency. Reading `JobsModule`, you don't see `PrismaModule` in imports — you don't know it uses Prisma. Acceptable for infrastructure providers. For domain providers (e.g., `UsersService` needed in `AuthModule`), explicit imports are better — they make the dependency visible.

### 4.4 Prisma Query Patterns — SQL Generated

**`findFirst` vs `findUnique`:**

```ts
// findUnique — uses unique index directly:
prisma.user.findUnique({ where: { email } })
// SQL: SELECT * FROM "User" WHERE email = $1 LIMIT 1
// Uses unique index on email — O(log n)

// findFirst — can use any fields + ordering:
prisma.job.findFirst({ where: { id: jobId, userId } })
// SQL: SELECT * FROM "Job" WHERE id = $1 AND user_id = $2 LIMIT 1
// Uses composite index or PK + filter
```

`findUnique` requires a unique field or compound unique constraint. `findFirst` is more flexible. Both return one row. Performance difference is marginal with proper indexes.

**`deleteMany` for ownership-safe delete:**

```ts
const { count } = await this.prisma.job.deleteMany({ where: { id: jobId, userId } });
// SQL: DELETE FROM "Job" WHERE id = $1 AND user_id = $2
// Returns: { count: 0 | 1 }
if (count === 0) throw new NotFoundException('Job not found');
```

One SQL statement. Combines ownership check + delete. If the job belongs to another user: `count = 0` → 404. If it doesn't exist: `count = 0` → 404. Same response. No existence leakage.

Alternative:
```ts
const job = await prisma.job.findFirst({ where: { id, userId } });     // query 1
if (!job) throw new NotFoundException();
await prisma.job.delete({ where: { id } });                             // query 2
```
Two round trips. `deleteMany` is both safer and faster.

**Nested writes — implicit transactions:**

```ts
await this.prisma.job.create({
  data: {
    company: dto.company,
    events: {
      create: { type: 'CREATED', toStatus: 'APPLIED' }  // nested create
    }
  }
})
```

Prisma wraps nested writes in an **implicit transaction**:

```sql
BEGIN;
  INSERT INTO "Job" (company, ...) VALUES ($1, ...) RETURNING id;
  INSERT INTO "JobEvent" (job_id, type, to_status) VALUES ($1, 'CREATED', 'APPLIED');
COMMIT;
```

If the `JobEvent` insert fails, the `Job` insert is rolled back. Atomicity guaranteed. You never have a `Job` row without its `CREATED` event.

**`upsert` — PostgreSQL `ON CONFLICT DO UPDATE`:**

```ts
prisma.companyProfile.upsert({
  where: { jobId },
  create: { jobId, status: 'PENDING' },
  update: { status: 'PENDING', industry: null },
})
```

Generated SQL:
```sql
INSERT INTO "CompanyProfile" (job_id, status) VALUES ($1, 'PENDING')
ON CONFLICT (job_id) DO UPDATE
  SET status = 'PENDING', industry = NULL, ...
RETURNING *;
```

Single atomic operation. The `where` clause must reference a unique field/constraint.

**`groupBy` — SQL `GROUP BY`:**

```ts
prisma.job.groupBy({ by: ['status'], where: { userId }, _count: { _all: true } })
```

Generated SQL:
```sql
SELECT status, COUNT(*) AS "_count"
FROM "Job"
WHERE user_id = $1
GROUP BY status;
```

Returns one row per distinct status. Statuses with zero jobs are absent — that's why we pre-initialize a zero-filled object and fill in actual counts.

**`Promise.all` for parallel queries:**

```ts
const [jobs, total] = await Promise.all([
  prisma.job.findMany({ where, skip, take }),
  prisma.job.count({ where }),
]);
```

Node.js is single-threaded but I/O is not. Both queries are sent to PostgreSQL simultaneously. PostgreSQL handles them in parallel (separate query planners). Both results arrive and the `Promise.all` resolves. Total time ≈ max(queryTime1, queryTime2), not sum.

---

## 5. Auth System — Full Deep Dive

> Source: https://datatracker.ietf.org/doc/html/rfc7519 (JWT spec)
> Source: https://datatracker.ietf.org/doc/html/rfc6749 (OAuth 2.0)
> Source: https://www.passportjs.org/concepts/authentication/
> Source: https://docs.nestjs.com/security/authentication

### 5.1 JWT Internals — What's in the Token

> Source: https://jwt.io/introduction
> Source: https://datatracker.ietf.org/doc/html/rfc7519#section-4

A JWT is: `base64url(header) . base64url(payload) . base64url(signature)`

**Header (algorithm + type):**
```json
{ "alg": "HS256", "typ": "JWT" }
```
Base64url encoded: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9`

**Payload (claims):**
```json
{
  "sub": "cm2x9abc...",
  "email": "user@example.com",
  "iat": 1700000000,
  "exp": 1700000900,
  "jti": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```
- `sub` (subject, RFC 7519 §4.1.2) — who the token is about. User UUID.
- `iat` (issued at, RFC 7519 §4.1.6) — Unix seconds when signed.
- `exp` (expiry, RFC 7519 §4.1.4) — Unix seconds when token expires. passport-jwt checks this.
- `jti` (JWT ID, RFC 7519 §4.1.7) — unique identifier for this token. In refresh tokens only — links JWT to its DB row.

**Signature:**
```
HMAC-SHA256(
  base64url(header) + '.' + base64url(payload),
  JWT_SECRET
)
```

The signature is computed over the encoded header + payload. If you change any character in either part, the signature won't match. This is **integrity protection**, not encryption.

**JWTs are NOT encrypted.** `base64url` is encoding, not encryption. Anyone who has the token can decode the payload with `atob()`. Never put sensitive data (passwords, PII, secrets) in a JWT payload. The guarantee is integrity (tamper detection), not confidentiality.

**HS256 vs RS256:**

| | HS256 | RS256 |
|-|-------|-------|
| Algorithm | HMAC-SHA256 (symmetric) | RSA-SHA256 (asymmetric) |
| Key | Shared secret (same for sign + verify) | Private key signs, public key verifies |
| Key distribution | Every verifier needs the secret | Verifiers only need public key (safe to distribute) |
| Use case | Single service issuing + verifying | Multi-service: auth service signs, other services verify |
| Speed | Faster | Slower (RSA operations are expensive) |

This codebase uses HS256. The same service that issues tokens also verifies them — no need to distribute a public key. Simpler, faster, sufficient.

### 5.2 bcrypt — Password and Token Hashing

> Source: https://en.wikipedia.org/wiki/Bcrypt
> Source: https://www.npmjs.com/package/bcrypt

```ts
const hashed = await bcrypt.hash(dto.password, 10);
// 10 = cost factor (salt rounds)
```

**Blowfish cipher + adaptive hashing:**

bcrypt is based on the Blowfish cipher's expensive key setup. The cost factor `N` means `2^N` iterations of the key setup. `N=10` → 1024 iterations. Typical hardware: ~100ms per hash. This is intentionally slow.

**Why slow?** An attacker who breaches the database gets hashed passwords. They can try to crack them offline (no rate limit, no account lockout). Slow hashing makes this expensive:

```
1024 iterations × 1M guesses = ~28 hours at 1 GPU
vs
SHA-256 (fast hash): same 1M guesses = ~1 second
```

**The salt:** bcrypt generates a random 128-bit salt for each password. The salt is embedded in the output hash:
```
$2b$10$<22-char-salt><31-char-hash>
```
- `$2b$` — bcrypt version
- `10` — cost factor
- 22 chars — base64-encoded salt
- 31 chars — base64-encoded hash

Two users with the same password get different hashes. Rainbow table attacks (precomputed hash lookup) are defeated.

**Timing safety:** `bcrypt.compare(plain, hash)` always runs the full hashing computation regardless of where the comparison fails. Constant-time comparison — doesn't leak information about how many characters matched. Plain `===` comparison leaks timing info via short-circuit evaluation.

**Why cost factor 10?**
- Factor 10: ~100ms on modern hardware
- Factor 12: ~400ms (4x slower, 4x harder to crack)
- Factor 14: ~1600ms (too slow for login UX)

10 is the industry standard recommendation for web applications as of 2024. Bcrypt is adaptive — you can increase the factor as hardware gets faster without invalidating existing hashes (just re-hash on next login).

**Refresh token hashing:**
```ts
const tokenHash = await bcrypt.hash(refreshToken, 10);
```
Refresh tokens are 128-bit random UUIDs (`randomUUID()`). With that entropy, an attacker can't crack the hash even with unlimited time. The bcrypt hash here isn't for brute-force resistance (the token itself is random enough) — it's so a database dump doesn't give the attacker usable tokens.

### 5.3 Passport.js — How Strategies Work

> Source: https://www.passportjs.org/concepts/authentication/
> Source: https://docs.nestjs.com/security/authentication#implementing-passport-strategies

**What Passport is:** A middleware library with a plugin system. Each "strategy" plugin handles a specific auth mechanism. Passport normalizes the result into `req.user`.

**The `PassportStrategy(Strategy, name)` mixin:**

```ts
// How NestJS wraps Passport:
function PassportStrategy(Strategy: any, name?: string) {
  abstract class MixinStrategy extends Strategy {
    constructor(...args: any[]) {
      super(...args);
      // Registers this instance with Passport under 'name'
      passport.use(name ?? Strategy.name, this);
    }

    // abstract — your subclass implements this:
    abstract validate(...args: any[]): any;
  }
  return MixinStrategy;
}
```

The mixin class registers the strategy with Passport's registry under the name. `@UseGuards(AuthGuard('jwt'))` → Passport looks up the strategy named `'jwt'` and calls its authenticate method.

**What `validate()` does and doesn't do:**

`validate()` is called AFTER the strategy's extraction + verification. For `JwtStrategy`, passport-jwt:
1. Extracts the token from `Authorization: Bearer`
2. Verifies the signature with `secretOrKey`
3. Checks `exp` claim
4. If all pass → calls `validate(payload)`

Your `validate()` only handles business logic (does this user exist in DB?). The cryptographic verification is done by passport-jwt before your code runs.

The return value of `validate()` becomes `req.user`. If `validate()` throws, Passport calls the failure callback → 401.

**The five strategies in this codebase:**

| Strategy name | Where credentials come | What `validate` does | Sets `req.user` to |
|--------------|----------------------|---------------------|-------------------|
| `local` | `req.body.email` + `req.body.password` | DB lookup + bcrypt compare | full User object from DB |
| `jwt` | `Authorization: Bearer` header | DB user lookup by `sub` | `{ id, email, name, avatarUrl }` |
| `jwt-refresh` | `req.body.refreshToken` | extracts raw token string | `{ sub, email, jti, refreshToken }` |
| `google` | OAuth redirect from Google | calls `handleOAuthUser` | `{ accessToken, refreshToken }` |
| `github` | OAuth redirect from GitHub | calls `handleOAuthUser` | `{ accessToken, refreshToken }` |

### 5.4 `issueTokens()` — Complete Breakdown

```ts
private async issueTokens(userId: string, email: string) {
  const jti = randomUUID();
  const payload = { sub: userId, email };

  const [accessToken, refreshToken] = await Promise.all([
    this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_SECRET'),
      expiresIn: this.config.get('JWT_EXPIRES_IN'),   // '15m'
    }),
    this.jwt.signAsync({ ...payload, jti }, {
      secret: this.config.get('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN'),  // '7d'
    }),
  ]);

  const tokenHash = await bcrypt.hash(refreshToken, 10);
  const refreshExpiry = this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';
  const expiresAt = new Date(Date.now() + ms(refreshExpiry as StringValue));

  await this.prisma.refreshToken.create({
    data: { id: jti, userId, tokenHash, expiresAt },
  });

  return { accessToken, refreshToken };
}
```

**`jti` — the dual-role UUID:**

`jti` is generated fresh with `randomUUID()` (128 bits of entropy, cryptographically random via `crypto.getRandomValues` internally). It appears twice:
1. In the refresh JWT payload as the `jti` claim
2. As the primary key of the `RefreshToken` DB row (`id: jti`)

When a refresh token arrives, the service:
```ts
const stored = await this.prisma.refreshToken.findUnique({ where: { id: jti } });
```
`jti` extracted from the JWT payload → direct primary key lookup. No scan.

**`Promise.all` for signing:**

Both `signAsync` calls are computationally bound (HMAC-SHA256). Node.js's `crypto` module runs HMAC in libuv's thread pool (C++ layer, not the JS event loop). `Promise.all` dispatches both to the thread pool simultaneously. Total time ≈ max(signTime1, signTime2) instead of signTime1 + signTime2.

**`ms()` for expiry calculation:**

> Source: https://github.com/vercel/ms

```ts
ms('7d')   // → 604800000 (milliseconds)
ms('15m')  // → 900000
```

`ms` converts human-readable duration strings to milliseconds. The `expiresAt` DB field mirrors what the JWT's `exp` claim says. This redundancy lets the server reject tokens via DB lookup (checking `stored.expiresAt < new Date()`) without re-verifying the JWT signature — a defense-in-depth measure.

**Why store both `expiresAt` in DB AND in the JWT `exp` claim?**

The JWT `exp` is checked by passport-jwt (step 1). The DB `expiresAt` is checked in `AuthService.refresh()` (step 2). If someone manually issues a refresh JWT with a far-future `exp` (impossible without the secret, but belt-and-suspenders), the DB check catches it. Two independent expiry guards.

### 5.5 Token Refresh — Security Properties

**Complete flow:**

```
POST /auth/refresh  { refreshToken: "eyJ..." }

1. JwtRefreshStrategy:
   - ExtractJwt.fromBodyField('refreshToken') → extracts JWT string from body
   - passport-jwt verifies signature with JWT_REFRESH_SECRET
   - passport-jwt checks exp claim
   - If invalid: 401 (before your code runs)
   - validate(req, payload) → { sub, email, jti, refreshToken: rawString }
   - req.user = above

2. Controller:
   refresh(@Body() dto, @Req() req) {
     const user = req.user as { sub, email, jti };
     return this.authService.refresh(user.sub, user.email, dto.refreshToken, user.jti);
   }

3. AuthService.refresh(userId, email, rawToken, jti):
   a. findUnique({ where: { id: jti } })           → get stored hash
   b. Check stored.userId === userId               → token belongs to this user
   c. Check stored.expiresAt >= now               → not expired (belt-and-suspenders)
   d. bcrypt.compare(rawToken, stored.tokenHash)  → cryptographic verification
   e. delete({ where: { id: jti } })             → invalidate old token
   f. issueTokens(userId, email)                  → new pair, new jti, new DB row

4. Return { accessToken, refreshToken }
```

**Why `passReqToCallback: true` in `JwtRefreshStrategy`?**

```ts
super({ ..., passReqToCallback: true })

validate(req: Request, payload: JwtPayload) {
  const refreshToken = req.body?.refreshToken;  // ← need the raw string
  return { ...payload, refreshToken };
}
```

Without this, `validate()` only receives `payload` (the decoded JWT claims). We need the **raw JWT string** to pass to `bcrypt.compare(rawString, storedHash)`. The decoded payload doesn't contain the raw string — you need the original token. `passReqToCallback: true` makes Passport pass `req` as the first argument to `validate()`.

**Token rotation security property:**

Each refresh token row in `RefreshToken` is single-use. After a successful refresh:
- Old row: deleted
- New row: created with new `jti`, new hash

If an attacker steals Token A and uses it before the legitimate user:
```
Attacker uses Token A → old row deleted → new Token B issued to attacker
Legitimate user tries Token A → row not found → 403 Forbidden
Legitimate user notices they're logged out → changes password/reports theft
Attacker's Token B → only lives until the legitimate user changes their password (which triggers logout)
```

Detection mechanism: the legitimate user's next refresh fails, forcing re-login. This signals "your session was compromised".

### 5.6 OAuth 2.0 — RFC 6749 Authorization Code Flow

> Source: https://datatracker.ietf.org/doc/html/rfc6749#section-4.1

**Standard Authorization Code Flow:**
```
1. Client → Authorization Server: GET /authorize?client_id=X&redirect_uri=Y&scope=email
2. User logs in at Authorization Server
3. Authorization Server → Client: 302 to Y?code=AUTH_CODE
4. Client → Authorization Server: POST /token { code, client_secret }
5. Authorization Server → Client: { access_token, refresh_token }
```

**This codebase's OAuth (server-side flow):**
```
1. Browser → GET /auth/google
   → PassportJS GoogleStrategy → 302 to Google consent screen

2. Google consent → 302 to /auth/google/callback?code=GOOGLE_CODE

3. GoogleStrategy intercepts the callback:
   → Exchanges GOOGLE_CODE for Google access token (server-to-server)
   → Calls Google userinfo API to get email, name, avatar
   → validate() calls handleOAuthUser() → issues app JWTs
   → Sets req.user = { accessToken: APP_JWT, refreshToken: APP_JWT }

4. Controller googleCallback():
   → storeOAuthCode(req.user) → stores app tokens in memory Map
   → Returns UUID code
   → 302 to ${FRONTEND_URL}/callback?code=UUID

5. Frontend callback page:
   → POST /auth/exchange-code { code: UUID }
   → Server looks up code → returns { accessToken, refreshToken }
   → Frontend stores tokens
```

**Why not put tokens in the redirect URL (step 4)?**

Tokens in URLs are exposed in:
- **Browser history** — logged persistently in the address bar history
- **Server access logs** — Nginx/Apache log full URLs including query params
- **Referrer header** — if the frontend page has any third-party scripts/images, the URL (including tokens) is sent as `Referer` to those domains
- **Browser cache** — cached URLs can include query params

The UUID code is harmless in all these contexts. It's short-lived (60s), single-use, and meaningless without the server-side Map lookup.

### 5.7 `handleOAuthUser` — Account Linking Strategy

```ts
async handleOAuthUser(provider, providerAccountId, email, name, avatarUrl) {
  // Priority 1: Same OAuth account used before
  const account = await prisma.account.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId } },
    include: { user: true },
  });
  if (account) return issueTokens(account.user.id, account.user.email);

  // Priority 2: Email exists → link new provider
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({ data: { email, name, avatarUrl } });
  }

  await prisma.account.create({ data: { provider, providerAccountId, userId: user.id } });
  return issueTokens(user.id, user.email);
}
```

**The `Account` model** stores OAuth provider linkage:
```
Account { provider, providerAccountId, userId }
Unique: [provider, providerAccountId]
```

One `User` can have multiple `Account` rows (one per OAuth provider). This is the standard social login account model.

**`provider_providerAccountId` in Prisma** is Prisma's generated accessor for a compound unique constraint `@@unique([provider, providerAccountId])`. The name is auto-generated as `{field1}_{field2}`.

**Priority 2 — email linking:**

Scenario: user registered with `user@gmail.com` + password. Later they try "Sign in with Google" using the same Gmail. Step 1 finds no `Account` for Google. Step 2 finds the existing `User` by email. Creates a new `Account` row linking Google to that user. The user now has two login methods for one account.

Without email linking, they'd get a P2002 error (duplicate email in `User` table) or a second account — confusing UX.

**Potential race condition in steps 2-3:**

Two simultaneous Google logins with a new email both pass `findUnique` (both see `null`) and both try `create`. The second `create` throws P2002 → `GlobalExceptionFilter` returns 409. The user retries — the second attempt now finds the `User` via step 1 (the Account was created) and succeeds. Edge case in practice; acceptable without a serializable transaction.

### 5.8 `storeOAuthCode` / `exchangeOAuthCode`

```ts
private readonly oauthCodes = new Map<
  string,
  { accessToken: string; refreshToken: string; expiresAt: number }
>();

storeOAuthCode(tokens): string {
  const code = randomUUID();
  this.oauthCodes.set(code, { ...tokens, expiresAt: Date.now() + 60_000 });
  return code;
}

exchangeOAuthCode(code: string) {
  const entry = this.oauthCodes.get(code);
  this.oauthCodes.delete(code);     // delete BEFORE checking — prevents timing oracle
  if (!entry || entry.expiresAt < Date.now()) {
    throw new ForbiddenException('OAuth code expired or already used');
  }
  return { accessToken: entry.accessToken, refreshToken: entry.refreshToken };
}
```

**Delete before checking:** The code is removed from the Map regardless of whether it's valid. If you checked first then deleted, an attacker could probe whether a code exists by sending many rapid requests — the first would return 403, the rest would also return 403, but with different timing depending on whether the code existed. Delete-first makes all responses take the same code path.

**In-memory Map vs Redis:**

For single-server deployment (this app's constraint — Oracle Cloud A1 single VM), in-memory is correct:
- Zero latency (no network hop)
- Zero infrastructure cost
- 60-second TTL means no meaningful persistence requirement
- Server restart during 60-second window: user retries OAuth, which takes 2 seconds

For multi-server deployments, use Redis: `oauthCodes.set(code, JSON.stringify(tokens), 'EX', 60)`.

---

## 6. Common Layer

> Source: https://docs.nestjs.com/guards
> Source: https://docs.nestjs.com/exception-filters
> Source: https://docs.nestjs.com/custom-decorators

### 6.1 `@Public()` — Metadata-Driven Route Opt-Out

```ts
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

**`SetMetadata(key, value)`** is a NestJS utility that returns a decorator factory. It calls:
```ts
Reflect.defineMetadata(key, value, target, propertyKey)
```

The metadata is stored on the class/method via `reflect-metadata`. Later, `Reflector` reads it:

```ts
this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
  context.getHandler(),  // method function — checked first
  context.getClass(),    // controller class — checked second
])
```

**`getAllAndOverride` semantics:** Returns the first defined value from the list of targets. If the method has `isPublic: true`, that's returned. If not, check the class. If neither has the metadata, returns `undefined` (falsy → guard runs normally).

**Why not check a list of public routes in the guard?**

```ts
// BAD approach:
const PUBLIC_ROUTES = ['/auth/login', '/auth/register'];
if (PUBLIC_ROUTES.includes(request.url)) return true;
```

Problems: URL matching is fragile (query params, trailing slashes, prefix changes). Adding a new public route requires modifying the guard. The metadata approach is co-located with the route definition — you see `@Public()` right next to `@Post('login')`.

### 6.2 `@CurrentUser()` — Custom Parameter Decorator

> Source: https://docs.nestjs.com/custom-decorators#param-decorators

```ts
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
```

**`createParamDecorator(factory)`:**
- `factory` receives `(data, ctx)` where `data` is any argument passed: `@CurrentUser('id')` → `data = 'id'`
- The factory's return value becomes the parameter's runtime value
- NestJS evaluates the factory for each request

**`ctx.switchToHttp()`:** NestJS supports HTTP, WebSockets, and gRPC. Guards, filters, and interceptors receive `ExecutionContext` which abstracts over all transports. `.switchToHttp()` gets the HTTP-specific adapter; `.getRequest()` returns the raw Express `Request` object.

**When `req.user` is set:**

`JwtStrategy.validate()` returns `{ id, email, name, avatarUrl }`. Passport sets `req.user = returnValue`. This happens before the controller method runs (guard phase → strategy phase → handler phase).

**Why `@CurrentUser()` over `@Req() req: Request`?**

```ts
// With @Req():
findOne(@Req() req: Request, @Param('id') id: string) {
  const userId = (req.user as { id: string }).id;  // cast required, brittle
}

// With @CurrentUser():
findOne(@CurrentUser() user: { id: string }, @Param('id') id: string) {
  // typed, clear intent
}
```

`@CurrentUser()` is self-documenting, typed at the call site, and decouples controllers from Express's `Request` type. If you ever swap Express for Fastify, only the decorator implementation changes — all controllers stay the same.

### 6.3 `GlobalExceptionFilter` — Three Tiers

> Source: https://docs.nestjs.com/exception-filters

```ts
@Catch()   // ← catches ALL exceptions (no argument = universal catch)
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    // Tier 1: NestJS HttpExceptions — pass through with original status + body
    if (exception?.getStatus) {
      return response.status(exception.getStatus()).json(exception.getResponse());
    }

    // Tier 2: Prisma known errors — map to HTTP
    if (exception?.code === 'P2002') {
      return response.status(409).json({ statusCode: 409, message: 'A record with this value already exists', error: 'Conflict' });
    }
    if (exception?.code === 'P2025') {
      return response.status(404).json({ statusCode: 404, message: 'Record not found', error: 'Not Found' });
    }

    // Tier 3: Unknown — log stack, return 500
    this.logger.error(exception?.message, exception?.stack);
    return response.status(500).json({ statusCode: 500, message: 'Internal server error' });
  }
}
```

**Tier 1 — `HttpException` and subclasses:**

> Source: https://docs.nestjs.com/exception-filters#built-in-http-exceptions

NestJS ships: `BadRequestException` (400), `UnauthorizedException` (401), `ForbiddenException` (403), `NotFoundException` (404), `ConflictException` (409), `UnprocessableEntityException` (422), `InternalServerErrorException` (500).

All extend `HttpException` which has `getStatus()` and `getResponse()`. The filter checks `exception?.getStatus` (duck typing) — if that method exists, it's a NestJS HTTP exception → pass through.

Services throw these for business logic errors:
```ts
throw new NotFoundException('Job not found');
throw new ForbiddenException('Access denied');
throw new BadRequestException('Email already in use');
```

**Why duck typing (`exception?.getStatus`) instead of `instanceof HttpException`?**

In a Node.js project with multiple packages, `instanceof` can fail when two different versions of `@nestjs/common` are loaded (the class from one version is not `instanceof` the other). Duck typing (`has this method?`) works regardless of where the class came from.

**Tier 2 — Prisma error codes:**

> Source: https://www.prisma.io/docs/orm/reference/error-reference

Prisma throws plain `Error` objects with a `code` property:
- `P2002` — Unique constraint violation. "Cannot insert because a row with this unique field already exists." When `handleOAuthUser` tries to create a `User` with a duplicate email.
- `P2025` — Record required for operation but not found. When `update` or `delete` targets a record that doesn't exist.

Mapping these to proper HTTP responses prevents the Tier 3 generic 500 for these known, expected database states.

**Tier 3 — unknown errors:**

```ts
this.logger.error(exception?.message ?? 'Unknown error', exception?.stack);
return response.status(500).json({ statusCode: 500, message: 'Internal server error' });
```

Log the full stack trace server-side (critical for debugging). Return a generic message to the client. Never expose stack traces, file paths, SQL queries, or internal error messages to clients — they help attackers map the system.

### 6.4 `JwtAuthGuard` — How the Global Guard Reads Metadata

```ts
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) { super(); }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);  // → passport.authenticate('jwt')
  }
}
```

**`AuthGuard('jwt')` — what the parent class does:**

`AuthGuard('jwt')` is a NestJS function that returns a guard class. That class's `canActivate` calls `passport.authenticate('jwt', ...)` which:
1. Calls `JwtStrategy`'s extraction method (from `Authorization: Bearer`)
2. Verifies the JWT signature with `JWT_SECRET`
3. Checks the `exp` claim
4. If valid: calls `validate(payload)` → sets `req.user` → returns `true`
5. If invalid: calls the handleRequest failure callback → throws `UnauthorizedException`

**`super.canActivate(context)`** — calls the parent guard's canActivate which runs this whole Passport flow. We override `canActivate` only to insert the `@Public()` check before Passport runs.

**Why `Reflector` needs to be injected manually (in `main.ts`):**

```ts
app.useGlobalGuards(new JwtAuthGuard(app.get(Reflector)));
```

`useGlobalGuards` registers outside the NestJS DI system. The constructor needs `Reflector` but the DI container won't inject it. `app.get(Reflector)` pulls `Reflector` from the container and we pass it manually. This is the only exception in the codebase to normal DI.

---

## 7. Jobs Module

> Source: https://docs.nestjs.com/controllers
> Source: https://www.prisma.io/docs/orm/prisma-client/queries/filtering-and-sorting

### 7.1 Security Pattern — No Existence Leakage

```ts
async findOne(userId: string, jobId: string) {
  const job = await this.prisma.job.findFirst({
    where: { id: jobId, userId },
    include: { companyProfile: true, resume: true },
  });
  if (!job) throw new NotFoundException('Job not found');
  return job;
}
```

**The security property explained:**

Without this pattern:
```ts
// BAD:
const job = await prisma.job.findUnique({ where: { id: jobId } });
if (!job) throw new NotFoundException();
if (job.userId !== userId) throw new ForbiddenException();  // ← existence leak!
```

If an attacker probes job IDs:
- Non-existent ID → 404
- ID belonging to another user → 403  ← "this ID exists, it's just not yours"

With the pattern:
```ts
// GOOD:
const job = await prisma.job.findFirst({ where: { id: jobId, userId } });
if (!job) throw new NotFoundException();  // always 404, regardless of reason
```

- Non-existent ID → 404
- ID belonging to another user → 404  ← indistinguishable

An attacker probing for valid job IDs gets no signal. This is the **opaque ownership** pattern. The DB query's `userId` clause acts as both authorization check AND existence filter simultaneously.

### 7.2 `findOwned` — Lean Authorization Check

```ts
private async findOwned(userId: string, jobId: string) {
  const job = await this.prisma.job.findFirst({
    where: { id: jobId, userId },
    select: { id: true, status: true },  // 2 columns only
  });
  if (!job) throw new NotFoundException('Job not found');
  return job;
}
```

vs

```ts
async findOne(userId: string, jobId: string) {
  const job = await this.prisma.job.findFirst({
    where: { id: jobId, userId },
    include: { companyProfile: true, resume: true },  // 2 JOINs
  });
```

SQL generated by `findOne`:
```sql
SELECT j.*, cp.*, r.*
FROM "Job" j
LEFT JOIN "CompanyProfile" cp ON cp.job_id = j.id
LEFT JOIN "Resume" r ON r.job_id = j.id
WHERE j.id = $1 AND j.user_id = $2
LIMIT 1;
```

SQL generated by `findOwned`:
```sql
SELECT id, status
FROM "Job"
WHERE id = $1 AND user_id = $2
LIMIT 1;
```

Write operations (`update`, `remove`) use `findOwned` because:
1. They need `existing.status` only (to detect status changes for event logging)
2. They don't use `companyProfile` or `resume` data
3. No JOINs = less data transferred, less memory, faster

### 7.3 Event Logging — Atomicity via Nested Writes

**On create:**
```ts
await this.prisma.job.create({
  data: {
    company: dto.company,
    userId,
    events: {
      create: { type: JobEventType.CREATED, toStatus: initialStatus }
    }
  }
});
// SQL transaction:
// INSERT INTO "Job" (...) VALUES (...) RETURNING id;
// INSERT INTO "JobEvent" (job_id, type, to_status) VALUES ($last_id, 'CREATED', 'APPLIED');
```

**On status change:**
```ts
const existing = await this.findOwned(userId, jobId);
const statusChanged = dto.status && dto.status !== existing.status;

return this.prisma.job.update({
  where: { id: jobId },
  data: {
    status: dto.status,
    ...(statusChanged && {
      events: {
        create: {
          type: JobEventType.STATUS_CHANGE,
          fromStatus: existing.status,
          toStatus: dto.status!,
        }
      }
    })
  }
});
```

**Why `existing.status` must come from a pre-fetch:** To create `fromStatus: existing.status`, you need the current status before the update. Prisma's `update` can't simultaneously read the old value and write a new one in the same query — you need to read first, then write. `findOwned` is that read.

**Why nested writes instead of two separate queries:**

```ts
// BAD — two queries:
await prisma.job.update({ where: { id }, data: { status: dto.status } });
await prisma.jobEvent.create({ data: { jobId, type: 'STATUS_CHANGE', fromStatus, toStatus } });
// If the second fails, job is updated but no event. Inconsistent.

// GOOD — one transaction via nested write:
await prisma.job.update({
  data: {
    status: dto.status,
    events: { create: { type: 'STATUS_CHANGE', ... } }
  }
});
// Both succeed or both fail. Always consistent.
```

### 7.4 `buildJobWhere` — Conditional Prisma Filter Builder

```ts
private buildJobWhere(userId: string, query: JobQueryDto) {
  const { status, priority, search, dateFrom, dateTo } = query;
  return {
    userId,
    ...(status && { status }),
    ...(priority && { priority }),
    ...(search && {
      OR: [
        { company: { contains: search, mode: 'insensitive' as const } },
        { position: { contains: search, mode: 'insensitive' as const } },
      ]
    }),
    ...(dateFrom || dateTo ? {
      appliedAt: {
        ...(dateFrom && { gte: new Date(dateFrom) }),
        ...(dateTo && { lte: new Date(dateTo) }),
      }
    } : {}),
  };
}
```

**Spread conditional pattern `...(condition && { key: value })`:**

```ts
false && { key: 'value' }   // → false
true && { key: 'value' }    // → { key: 'value' }

{ ...false }    // → {}  (spreading false is a no-op in ES2018)
{ ...{ key: 'value' } }   // → { key: 'value' }
```

This is idiomatic TypeScript/JavaScript for optionally including object properties. If `status` is undefined, `{ ...(undefined && { status }) }` → `{ ...false }` → `{}`. The `status` filter is simply absent from the Prisma `where` — Prisma doesn't filter on absent fields.

**`mode: 'insensitive' as const`:**

Prisma maps `mode: 'insensitive'` to PostgreSQL's `ILIKE` operator:
```sql
WHERE company ILIKE '%google%'
-- matches: "Google", "GOOGLE", "google.com"
```

Without it (case-sensitive): `WHERE company LIKE '%google%'` — wouldn't match "Google".

`as const` is TypeScript narrowing — without it, the type is `string`, but Prisma expects `'default' | 'insensitive'`. `as const` narrows to the literal type.

**`OR` for multi-field search:**
```sql
WHERE (company ILIKE '%search%' OR position ILIKE '%search%')
```
Users can search by company name or job title. PostgreSQL evaluates `OR` — if `company` matches, it short-circuits. For larger datasets, full-text search (tsvector) would be more efficient, but ILIKE is sufficient for a personal app with hundreds of rows.

**Reuse in `findAll` and `exportCsv`:**

Both operations expose the same filtering surface. `buildJobWhere` is the single source of truth for filter logic. If you add a `location` filter, you add it once.

### 7.5 Pagination — Offset vs Cursor

> Source: https://www.prisma.io/docs/orm/prisma-client/queries/pagination

**Offset pagination (this codebase):**
```ts
skip: (page - 1) * limit,
take: limit,
// SQL: LIMIT $limit OFFSET $offset
```

PostgreSQL must:
1. Apply all WHERE filters
2. Sort results
3. Scan past `$offset` rows (discarding them)
4. Return `$limit` rows

For `page=1`: fast (offset=0, no wasted work). For `page=1000, limit=10`: PostgreSQL scans 9990 rows just to discard them. Performance degrades with high page numbers.

**Cursor-based pagination (alternative):**
```ts
// After fetching page 1, remember the last item's ID:
cursor: { id: lastItemId },
take: limit,
skip: 1,  // skip the cursor item itself
// SQL: WHERE id > $lastId ORDER BY id LIMIT $limit
// Uses index on id — O(log n) regardless of page
```

More complex to implement (client must track cursor). Better for "infinite scroll" patterns. Overkill for a job tracker with maybe 200 jobs max.

**Parallel count query:**
```ts
const [jobs, total] = await Promise.all([
  prisma.job.findMany({ where, skip, take }),
  prisma.job.count({ where }),
]);
```

`total` is needed for `totalPages: Math.ceil(total / limit)`. Running count and data query in parallel saves the sequential overhead. Both queries use the same `where` → same index hit.

### 7.6 Stats — `groupBy` and Response Rate

```ts
const [counts, total, thisMonth] = await Promise.all([
  prisma.job.groupBy({ by: ['status'], where: { userId }, _count: { _all: true } }),
  prisma.job.count({ where: { userId } }),
  prisma.job.count({ where: { userId, appliedAt: { gte: startOfMonth } } }),
]);
```

Three queries, all parallel. `groupBy` generates:
```sql
SELECT status, COUNT(*) AS count FROM "Job" WHERE user_id = $1 GROUP BY status;
```

Result: `[{ status: 'APPLIED', _count: { _all: 5 } }, { status: 'OFFER', _count: { _all: 1 } }]`

Statuses with 0 jobs are absent. Pre-initialization:
```ts
const byStatus = Object.values(JobStatus).reduce(
  (acc, s) => ({ ...acc, [s]: 0 }),
  {} as Record<JobStatus, number>
);
```

`Object.values(JobStatus)` reads from the Prisma-generated `JobStatus` enum — `['APPLIED', 'INTERVIEWING', 'OFFER', 'REJECTED', 'WITHDRAWN']`. `reduce` builds `{ APPLIED: 0, INTERVIEWING: 0, ... }`. Fill in actual counts. The client always receives a complete object.

**Response rate formula:**

```ts
const responded = byStatus.INTERVIEWING + byStatus.OFFER + byStatus.REJECTED;
const responseRate = total > 0 ? Math.round((responded / total) * 1000) / 10 : 0;
```

"Responded" = any status that implies the company replied (interview invite, offer, or rejection). `APPLIED`, `WITHDRAWN` = no response yet.

`Math.round((5/7) * 1000) / 10`:
- `(5/7)` = 0.714285...
- `* 1000` = 714.285...
- `Math.round` = 714
- `/ 10` = 71.4

One decimal place without `toFixed` (which returns a string).

### 7.7 Route Registration Order

```ts
@Controller('jobs')
export class JobsController {
  @Get('stats')   // ← MUST be before :id
  @Get('export')  // ← MUST be before :id
  @Get(':id')     // parameterized — matches any string
  @Get(':id/events')
}
```

**Why order matters:**

Express (which NestJS uses internally) builds a route trie. Routes are matched in registration order. `:id` is a wildcard segment — it matches any non-slash string. If registered first, `GET /jobs/stats` matches `:id` with `id = 'stats'` → calls `findOne(user, 'stats')` → Prisma tries to find a job with UUID `'stats'` → returns null → 404.

NestJS registers routes in the order they appear in the class. Fixed-path routes before parameterized routes. This is a controller design discipline, not enforced by the framework — you could break it by adding a new route in the wrong position.

### 7.8 `remove` — Storage Cleanup Pattern

```ts
async remove(userId: string, jobId: string) {
  // 1. Check for associated resume BEFORE delete (cascade would lose the key)
  const resume = await this.prisma.resume.findFirst({
    where: { jobId, job: { userId } },
    select: { storageKey: true },
  });

  // 2. Delete job (cascades to JobEvent, CompanyProfile, Resume rows via DB)
  const { count } = await this.prisma.job.deleteMany({ where: { id: jobId, userId } });
  if (count === 0) throw new NotFoundException('Job not found');

  // 3. Clean up storage file (best-effort — fire and forget)
  if (resume) {
    await this.storage.delete(resume.storageKey).catch(err =>
      this.logger.warn('Storage delete failed after job remove', { storageKey: resume.storageKey, err })
    );
  }

  return { message: 'Job deleted' };
}
```

**Step 1 before Step 2:** The `Resume` row is cascade-deleted when the `Job` is deleted. After `deleteMany`, the Resume row is gone — we can't get the `storageKey`. So we fetch it first.

**Step 2 uses `deleteMany` not `delete`:** `delete` throws `P2025` if the record doesn't exist (which `GlobalExceptionFilter` maps to 404, but it's a caught exception). `deleteMany` returns `{ count: 0 }` for no match — cleaner control flow. Also combines ownership check + delete in one query.

**Step 3 is fire-and-forget with `.catch`:** Storage deletion is not critical-path. A dangling file in object storage is much better than:
- Blocking the response waiting for storage
- Failing the delete because storage had a transient error

The `.catch(warn)` logs a warning so orphaned files are discoverable for manual cleanup. `catch(() => undefined)` swallows silently — not used here because we want visibility.

---

## 8. Storage Module

> Source: https://docs.nestjs.com/fundamentals/custom-providers#factory-providers-usefactory
> Source: https://refactoring.guru/design-patterns/strategy

### 8.1 Strategy Pattern via Factory Provider

**The Gang of Four Strategy Pattern:**

Define a family of algorithms (storage drivers), encapsulate each, make them interchangeable. Callers use the interface — not a concrete class.

```
IStorageService (interface)
├── LocalStorageService  (writes to disk — dev)
└── OracleStorageService (writes to OCI Object Storage — prod)

Callers inject: IStorageService
Reality: whichever implementation was selected at startup via STORAGE_DRIVER
```

**The string injection token:**

```ts
// storage.service.ts
export const STORAGE_SERVICE = 'STORAGE_SERVICE';  // runtime constant

export interface IStorageService {
  upload(key: string, buffer: Buffer, mimeType: string): Promise<void>;
  getPresignedUrl(key: string, expiresIn?: number): Promise<string>;
  delete(key: string): Promise<void>;
}
```

**Why a string token, not a class?**

DI tokens must be values that exist at runtime. TypeScript interfaces are type-only — completely erased during compilation. `IStorageService` doesn't exist at runtime; you can't use it as a lookup key. The string `'STORAGE_SERVICE'` exists at runtime and is a valid Map key in the DI container.

Abstract classes could work (they do exist at runtime), but that forces callers to depend on the abstract class. String tokens keep the contract as a pure interface.

**Factory provider:**

```ts
@Global()
@Module({
  providers: [{
    provide: STORAGE_SERVICE,
    inject: [ConfigService],
    useFactory: (config: ConfigService) => {
      const driver = config.get<string>('STORAGE_DRIVER', 'local');
      if (driver === 'oracle') return new OracleStorageService(config);
      return new LocalStorageService(config);
    },
  }],
  exports: [STORAGE_SERVICE],
})
export class StorageModule {}
```

`useFactory` — called once at startup (singleton). Result is stored under `STORAGE_SERVICE` token. `inject: [ConfigService]` — listed tokens are resolved from the DI container and passed as factory arguments. The factory chooses which concrete class to return.

**Injecting by string token:**

```ts
@Inject(STORAGE_SERVICE) private storage: IStorageService
```

For class tokens (e.g., `PrismaService`), NestJS infers the token from the TypeScript type via `reflect-metadata`. For string tokens, there's no type metadata — `@Inject(STORAGE_SERVICE)` tells NestJS explicitly which token to look up.

### 8.2 Storage Key Design

Key format: `resumes/<userId>/<jobId>/<uuid>.pdf`

```
resumes/                        ← namespace
  cm2x9abc-1234-5678-abcd/      ← userId (auth check: key's userId must match JWT user)
    cm3y5def-9012-3456-efgh/    ← jobId (find resume for a specific job)
      f47ac10b-58cc-4372.pdf    ← UUID (unique per upload; replace = new key)
```

**Why UUID per upload?** Replacing a resume for a job uses a new UUID key. The old file stays alive until the DB upsert succeeds and confirms the new key is active. This prevents a window where the DB points to a key whose file hasn't been uploaded yet. After the DB commit, the old file is deleted. The UUID also ensures concurrent uploads don't overwrite each other.

### 8.3 `LocalStorageService` — Dev Driver

```ts
async upload(key: string, buffer: Buffer, _mimeType: string): Promise<void> {
  const filePath = path.join(this.uploadsDir, key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
}

getPresignedUrl(key: string): Promise<string> {
  return Promise.resolve(
    `${this.backendUrl}/jobs/resumes/file?key=${encodeURIComponent(key)}`
  );
}

async delete(key: string): Promise<void> {
  await fs.unlink(path.join(this.uploadsDir, key)).catch(() => undefined);
}
```

`fs.mkdir({ recursive: true })` — the key `resumes/userId/jobId/uuid.pdf` implies a directory tree. `recursive: true` = `mkdir -p`. Without it, the first upload for a user fails if the parent directories don't exist yet.

`getPresignedUrl` for local returns a URL pointing to `GET /jobs/resumes/file?key=...`. The controller validates JWT auth before serving. Mimics the Oracle interface — callers can't tell the difference.

`delete.catch(() => undefined)` — `fs.unlink` throws `ENOENT` if file doesn't exist. When file is already gone (partial failure recovery), silently succeed. Goal is "ensure file is absent" — already absent = goal achieved.

`_mimeType` leading underscore — TypeScript `noUnusedParameters` would flag this. Oracle uses it (S3 `Content-Type` header). Local writes raw bytes — MIME type irrelevant.

### 8.4 Oracle Storage — S3-Compatible API

> Source: https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/s3compatibleapi.htm

OCI Object Storage implements the Amazon S3 API. The service uses AWS SDK v3 pointed at OCI's S3-compatible endpoint. Presigned URLs let clients fetch directly from OCI — the backend never proxies binary content in production.

**Presigned URL mechanics:**

A presigned URL embeds authentication as query parameters:
```
https://objectstorage.<region>.oraclecloud.com/n/<namespace>/b/<bucket>/o/<key>
  ?X-Amz-Algorithm=AWS4-HMAC-SHA256
  &X-Amz-Credential=...
  &X-Amz-Expires=900
  &X-Amz-Signature=<hmac>
```

OCI validates the HMAC and expiry. The browser fetches directly — no Node.js involved in binary transfer.

**Why presigned URLs?** Binary file content through Node.js is expensive — it passes through the JS event loop, uses memory, blocks I/O. For the Oracle driver, presigned URLs offload delivery entirely to OCI's CDN/storage layer. Backend only generates the URL (fast, tiny response).

**OCI gotchas (from memory notes):**
1. AWS SDK v3 adds `x-amz-checksum-*` headers by default — OCI rejects them → 400. Must opt out with `ChecksumAlgorithm: undefined`.
2. OCI Customer Secret Key is binary — must be hex-encoded for `AWS_SECRET_ACCESS_KEY`.
3. Endpoint format: `<namespace>.compat.objectstorage.<region>.oraclecloud.com` — different from AWS.

---

## 9. Enrichment Module — BullMQ & LLM

> Source: https://docs.bullmq.io/guide/queues
> Source: https://docs.bullmq.io/guide/workers
> Source: https://console.groq.com/docs/tool-use

### 9.1 Why a Queue

**Without a queue — synchronous enrichment:**
```
POST /jobs → INSERT job → Search × 2 (~1s) → Fetch URL (~1s) → LLM (~3s) → UPDATE profile
Response arrives after: ~5 seconds
```

Problems:
- 5 second job creation = terrible UX
- If Groq is down, job creation fails entirely
- No retry on partial failure
- Nginx timeout (60s default) can be hit on slow LLM responses

**With BullMQ:**
```
POST /jobs → INSERT job → queue.add({ jobId })  (< 1ms Redis push)
Response: < 100ms

[Worker, independently:]
  → Search → LLM → UPDATE profile
```

Decoupled, fast, retryable, independently scalable.

### 9.2 BullMQ Redis Data Structures

> Source: https://redis.io/commands/blmove/

BullMQ stores queue state in Redis:

```
bull:company-enrichment:wait       — Redis List (FIFO queue of waiting job IDs)
bull:company-enrichment:active     — Redis List (currently processing)
bull:company-enrichment:completed  — Redis Sorted Set (score = completion timestamp)
bull:company-enrichment:failed     — Redis Sorted Set (score = fail timestamp)
bull:company-enrichment:delayed    — Redis Sorted Set (score = when to re-queue)
bull:company-enrichment:<id>       — Redis Hash (job payload, opts, attempt count)
```

**`BLMOVE` — atomic job pickup:**

```
Worker executes atomically:
BLMOVE bull:company-enrichment:wait  bull:company-enrichment:active  RIGHT LEFT
```

This moves a job ID from `wait` to `active` atomically. Two workers can't pick the same job — if one gets it, it's already in `active` for the other. No race condition.

`BLMOVE` is blocking — the worker sits idle (no CPU usage) until a job appears. Much more efficient than polling.

**Retry flow:**

```
process() throws
→ attempts++ < maxAttempts (2)?
  → Yes: compute backoff delay (10s)
         ZADD delayed <now + 10000ms> <jobId>
         [10 seconds later] BLMOVE delayed wait
  → No: ZADD failed <timestamp> <jobId>
```

### 9.3 `EnrichmentService` — Enqueueing

```ts
async enqueueEnrichment(jobId: string): Promise<void> {
  await this.prisma.companyProfile.upsert({
    where: { jobId },
    create: { jobId, status: EnrichmentStatus.PENDING },
    update: {
      status: EnrichmentStatus.PENDING,
      industry: null, companySize: null, techStack: [],
      cultureSummary: null, remotePolicy: null, workLifeBalance: null,
      headquarters: null, founded: null, errorMessage: null, enrichedAt: null,
    },
  });
  await this.queue.add('enrich', { jobId }, {
    attempts: 2,
    backoff: { type: 'fixed', delay: 10_000 },
  });
}
```

**Why upsert CompanyProfile before queue.add?**

The worker's first action is `companyProfile.upsert({ update: { status: PROCESSING } })`. If the CompanyProfile row doesn't exist and the worker tries to `update` it, Prisma throws P2025. The `upsert` in `enqueueEnrichment` ensures the row exists before the worker runs. Since both upsert and queue.add can fail independently, the order ensures the safe state (row exists) before enqueuing.

**Why reset all fields on re-enrich?**

If re-enrichment is triggered (user manually requests it), we want a clean slate. Keeping stale `techStack` from the previous run alongside new `industry` from the current run would give inconsistent data. Full reset to null on re-enqueue ensures a fresh start.

### 9.4 Processor Detailed Flow

```ts
@Processor(ENRICHMENT_QUEUE)
export class EnrichmentProcessor extends WorkerHost {
  async process(job: Job<{ jobId: string }>): Promise<void> {
    const { jobId } = job.data;

    const dbJob = await this.prisma.job.findFirst({ where: { id: jobId } });
    if (!dbJob) {
      this.logger.warn('enrichment_job_not_found', { jobId });
      return;  // soft exit — job was deleted while queued
    }

    await this.prisma.companyProfile.upsert({
      where: { jobId },
      create: { jobId, status: EnrichmentStatus.PROCESSING },
      update: { status: EnrichmentStatus.PROCESSING, errorMessage: null },
    });

    try {
      const [overviewSnippets, cultureSnippets] = await Promise.all([
        this.search.search(`${company} company overview headquarters founded employees industry`),
        this.search.search(`${company} engineering tech stack remote work culture glassdoor`),
      ]);

      const pageText = await this.webFetch.fetchPageText(dbJob.url ?? '');

      const context = [...overviewSnippets, ...cultureSnippets, pageText]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 8000);

      const data = await this.llm.extract(company, context);

      await this.prisma.companyProfile.update({
        where: { jobId },
        data: { status: EnrichmentStatus.COMPLETED, ...data, enrichedAt: new Date() },
      });
    } catch (error) {
      const raw = error instanceof Error ? error.message : 'Enrichment failed';
      const errorMessage = raw.replace(/https?:\/\/\S+/g, '[url]').slice(0, 200);

      await this.prisma.companyProfile.update({
        where: { jobId },
        data: { status: EnrichmentStatus.FAILED, errorMessage },
      });

      throw error;  // CRITICAL — BullMQ determines success/failure by whether this throws
    }
  }
}
```

**Soft exit (`return` without throw) for deleted jobs:**

Returning without throwing = BullMQ marks the job `completed`. This is intentional: "job deleted" is not a retriable error — there's nothing to retry. Don't pollute the `failed` queue with non-errors.

**`throw error` at the end of catch:**

BullMQ's worker host wraps `process()`. If it throws: mark failed, retry if attempts remain. If it returns normally: mark completed. You MUST re-throw after handling failure in the DB. Not re-throwing = BullMQ thinks enrichment succeeded even though it failed.

**Error message sanitization:**

```ts
raw.replace(/https?:\/\/\S+/g, '[url]').slice(0, 200)
```

Error messages from Tavily/Groq/webFetch can contain:
- API endpoints with keys embedded: `https://api.tavily.com/search?api_key=tvly-abc123`
- Long error descriptions with internal URLs

Replace all URLs with `[url]`. Slice to 200 (DB column constraint). The log has the full error with stack; the DB field just needs to show the user something useful.

### 9.5 LLM Tool Use

> Source: https://console.groq.com/docs/tool-use

**Why tool use over "return JSON in prompt":**

Prompt engineering approach:
```ts
messages: [{ content: 'Return JSON: { "industry": "...", "techStack": [...] }' }]
// LLM might output:
// "Here's the JSON:\n```json\n{ ... }\n```"
// Or with trailing explanation text
// Or with wrong field types
```

Tool use (function calling) approach:
```ts
tools: [{ type: 'function', function: { name: 'extract_company_data', parameters: {...schema} } }]
tool_choice: 'required'  // LLM must call the tool
// Output: response.choices[0].message.tool_calls[0].function.arguments
// Always valid JSON matching the schema
```

The LLM API validates tool call arguments against the schema before returning. With `tool_choice: 'required'`, the model must produce a function call — no free text output.

**`sanitize()` — even with tool use:**

The LLM can still produce values outside declared `enum` ranges (`"startup"` instead of `"Startup (<50)"`), or empty strings instead of `"Unknown"`. `sanitize()` coerces every field:

```ts
function str(val: unknown): string {
  return typeof val === 'string' && val.trim() ? val.trim() : 'Unknown';
}
```

Non-string, null, undefined, whitespace-only → `'Unknown'`. Safe for Prisma (all enrichment string fields are `String?`).

**Why `llama-3.3-70b-versatile` on Groq?**

> Source: https://console.groq.com/docs/models

Groq runs on LPU (Language Processing Unit) hardware — inference at ~800 tokens/second. For structured extraction of ~500 output tokens, response time is < 1 second. Free tier supports tool use. API is OpenAI-compatible — switching to `gpt-4o` requires only changing client constructor and model name.

---

## 10. Resumes Module

> Source: https://docs.nestjs.com/techniques/file-upload
> Source: https://owasp.org/www-community/attacks/Path_Traversal

### 10.1 File Upload Pipeline

```
HTTP Request (multipart/form-data)
        ↓
JwtAuthGuard         — validate JWT, set req.user
ThrottlerGuard       — 5 req/min on this route
FileInterceptor      — Multer parses multipart body, stores in req.file.buffer
ParseFilePipe        — validate size + MIME type
Controller method    — calls service.upload()
Service              — magic bytes check → storage upload → DB upsert
```

**`memoryStorage()` vs default disk storage:**

Multer's default writes temp files to disk (`/tmp/upload_XXXXX`). `memoryStorage()` keeps file as a `Buffer` in `req.file.buffer`.

Why memory here:
- `IStorageService.upload` takes a `Buffer` — with disk storage you'd have to `fs.readFile(file.path)` first
- 8MB max file size is safe to buffer in memory
- Buffer is not kept — passed to storage service, then GC'd immediately

**`limits: { fileSize: 8MB }` in Multer:**

Enforced during streaming (before the full body is buffered). When accumulated bytes exceed 8MB, Multer aborts and sends a `MulterError`. Prevents memory exhaustion from large uploads before `ParseFilePipe` even runs.

### 10.2 Two-Layer File Validation

**Layer 1 — `ParseFilePipe` (HTTP layer):**
```ts
new FileTypeValidator({ fileType: 'application/pdf' })
```
Checks `file.mimetype` — from the `Content-Type` header in the multipart part. **Client-controlled.** A malicious client can lie:
```
Content-Type: application/pdf   ← lie
<binary content of evil.exe>    ← actual content
```
`FileTypeValidator` passes. This layer catches mistakes (user accidentally uploads wrong file type), not malicious actors.

**Layer 2 — magic bytes (service layer):**
```ts
if (file.buffer.subarray(0, 4).toString('ascii') !== '%PDF') {
  throw new UnprocessableEntityException('File must be a valid PDF');
}
```
PDF magic number: `25 50 44 46` hex = `%PDF` ASCII. This is in the **actual file content** — can't be spoofed via HTTP headers. Even if `FileTypeValidator` passes, the service rejects non-PDF content.

> Source: https://en.wikipedia.org/wiki/List_of_file_signatures

`subarray(0, 4)` — creates a Buffer view (no copy). `.toString('ascii')` converts bytes to ASCII characters. Comparison against string `'%PDF'`.

### 10.3 Upload Consistency — Storage-First

```
State machine for upload:

Storage upload (step 1)
  ↓ succeeds
DB upsert (step 2)
  ↓ succeeds           ← commit point
Delete old file (step 3) — fire-and-forget
  ↓
Done
```

**Failure at step 1:** Nothing written. Exception propagates. Clean state.

**Failure at step 2:** New file is in storage but DB doesn't point to it.
```ts
} catch (err) {
  await this.storage.delete(key).catch(() => undefined);  // rollback storage
  throw err;
}
```
Delete the newly uploaded file. DB upsert failed (rolled back by Prisma). Clean state.

**Failure at step 3:** Old file is dangling in storage. New file and DB record are correct.
```ts
await this.storage.delete(oldKey).catch(err =>
  this.logger.warn(`Failed to delete old resume key: ${err.message}`)
);
```
Log warning. The old file is unreachable (DB points to new key), harmless. Manual cleanup possible. Do not fail the request for this.

**Why storage-first and not DB-first?**
- If DB-first and storage fails: DB record points to a non-existent file → 404 on every resume fetch until manually fixed
- If storage-first and DB fails: orphaned storage file (unreachable) → harmless, can be GC'd

An orphaned storage file is always preferable to a DB record pointing to nowhere.

### 10.4 Path Traversal — Five Layers

> Source: https://owasp.org/www-community/attacks/Path_Traversal

```ts
@Get('resumes/file')
async serveFile(@CurrentUser() user, @Query('key') key, @Res() res) {
  // Gate 1: Only local storage mode
  if (this.config.get('STORAGE_DRIVER') === 'oracle') throw new NotFoundException();

  if (!key) throw new BadRequestException('Missing key');

  // Gate 2: Path traversal prevention
  const filePath = path.resolve(this.uploadsDir, key);
  if (!filePath.startsWith(this.uploadsDir + path.sep)) {
    throw new BadRequestException('Invalid key');
  }

  // Gate 3: Key structure enforcement
  const parts = key.split('/');
  if (parts.length !== 4 || parts[0] !== 'resumes') {
    throw new BadRequestException('Invalid key format');
  }
  const [, keyUserId, jobId] = parts;

  // Gate 4: Ownership check
  if (keyUserId !== user.id) throw new ForbiddenException('Access denied to this file');

  // Gate 5: File + DB record must both exist
  try { await fs.access(filePath); } catch { throw new NotFoundException('File not found'); }
  const resume = await this.resumesService.findByJob(user.id, jobId);
  if (!resume) throw new NotFoundException('File not found');

  res.sendFile(filePath);
}
```

**Gate 2 — `path.resolve` normalization:**
```
key = '../../etc/passwd'
path.resolve('/app/uploads', '../../etc/passwd') = '/etc/passwd'
'/etc/passwd'.startsWith('/app/uploads/') = false → BadRequest
```

**Why `uploadsDir + path.sep` not just `uploadsDir`?**
```
uploadsDir = '/app/uploads'
key = '../uploads-evil/file.pdf'
resolved = '/app/uploads-evil/file.pdf'
'/app/uploads-evil/file.pdf'.startsWith('/app/uploads') = true ← BYPASS without sep
'/app/uploads-evil/file.pdf'.startsWith('/app/uploads/') = false ← caught with sep
```

`path.sep` is OS-correct: `/` on Linux, `\` on Windows.

**Gate 4 — ownership via embedded userId:**

The key format includes `userId` as a path segment. An authenticated user can only get files where `key.split('/')[1] === user.id`. Even if path traversal were somehow bypassed, a user in directory A can't access directory B.

**Gate 5 — DB record required:**

Physical file existence + DB record. Protects against:
- Files planted in `uploads/` without DB records (no upload flow bypass)
- Files whose DB records were deleted but cleanup failed

### 10.5 `toDto()` — Never Return `storageKey`

```ts
private toDto({ id, jobId, originalName, size, createdAt }) {
  return { id, jobId, originalName, size, createdAt };
}
```

`storageKey` is an internal storage implementation detail:
- For local: a relative file path like `resumes/userId/jobId/uuid.pdf`
- For Oracle: an OCI Object Storage key

Sending it to clients would:
1. Expose internal storage structure (reconnaissance for attackers)
2. Let clients construct storage URLs directly
3. Make changing the storage key format a breaking API change

`toDto` is an explicit allowlist. Opt-in to what's returned, not opt-out.

---

## 11. Users Module

### 11.1 `toProfile` — Sensitive Data Exclusion

```ts
private async toProfile(userId: string) {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, name: true, avatarUrl: true, createdAt: true,
      password: true,         // fetched to compute boolean, never returned
      accounts: { select: { provider: true } },
    },
  });
  if (!user) throw new NotFoundException('User not found');

  const { password, accounts, ...rest } = user;
  return {
    ...rest,
    connectedProviders: accounts.map(a => a.provider),
    hasPassword: !!password,   // boolean only
  };
}
```

**`select` as allowlist vs default select-all:**

Without `select`, Prisma returns ALL `User` columns. Future columns (API keys, 2FA secrets, billing info) would automatically be returned. `select` is opt-in — only listed fields come back. Adding a sensitive column to the schema doesn't accidentally expose it via this endpoint.

**`!!password`:**
```
!!null       = false  (OAuth-only user — no password set)
!!"$2b$10$…" = true   (user has a password)
```
UI uses `hasPassword` to show/hide "Change Password". The hash itself never leaves the server.

**`connectedProviders`:**

`accounts` has all linked OAuth accounts. `map(a => a.provider)` → `['google', 'github']`. The settings page shows which OAuth providers are connected. We don't return `providerAccountId` (Google's user ID for this account) — it's internal.

### 11.2 Email Uniqueness — Explicit Check vs Implicit P2002

```ts
if (dto.email) {
  const taken = await this.prisma.user.findFirst({
    where: { email: dto.email, NOT: { id: userId } },
  });
  if (taken) throw new BadRequestException('Email already in use');
}
```

**`NOT: { id: userId }` — why it's necessary:**

Without `NOT`, updating your profile while keeping the same email: `findFirst({ where: { email: 'same@email.com' } })` finds your own row → "Email already in use" false positive. `NOT: { id: userId }` excludes your own row from the uniqueness check.

Generates SQL:
```sql
SELECT * FROM "User" WHERE email = $1 AND id != $2 LIMIT 1
```

**Explicit check vs catching P2002:**

Option A (this code): specific error message "Email already in use" (400).
Option B (let Prisma throw): generic "A record with this value already exists" (409).

Option A is better for UX — the user knows exactly what's wrong. 409 Conflict gives less useful feedback for form validation.

### 11.3 `changePassword` — All the Guards

```ts
async changePassword(userId, dto) {
  const user = await this.prisma.user.findUnique({ where: { id: userId } });

  // Guard 1: user exists + has a password (not OAuth-only)
  if (!user?.password) {
    throw new ForbiddenException('Account uses social login — set a password first');
  }

  // Guard 2: current password matches
  const valid = await bcrypt.compare(dto.currentPassword, user.password);
  if (!valid) throw new BadRequestException('Current password is incorrect');

  // Hash and save new password
  const hashed = await bcrypt.hash(dto.newPassword, 10);
  await this.prisma.user.update({ where: { id: userId }, data: { password: hashed } });
  return { message: 'Password updated successfully' };
}
```

**`!user?.password` — handles two cases:**

- `user = null`: User deleted between JWT issue and this call. `user?.password = undefined`. Throw 403.
- `user.password = null`: OAuth-only user. No password to compare against. `bcrypt.compare(anything, null)` would throw `TypeError: data and hash arguments required`. Throw 403 before getting there.

**`ForbiddenException` not `BadRequestException`:**

403 = valid request, operation not permitted for this user type.
400 = malformed request.

Changing a password for an OAuth-only account is a permissions issue, not a bad request. 403 is semantically correct.

**Why require `currentPassword` for password change?**

Prevents attackers who get access to a session (stolen JWT) from changing the password and locking out the real user. The real user must know the current password. This is standard best practice even for authenticated sessions.

---

## 12. DTOs & Validation Pipeline

> Source: https://docs.nestjs.com/pipes#class-validator
> Source: https://github.com/typestack/class-validator
> Source: https://github.com/typestack/class-transformer

### 12.1 `class-transformer` — `plainToInstance`

`ValidationPipe` with `transform: true` internally calls:

```ts
import { plainToInstance } from 'class-transformer';
const dto = plainToInstance(CreateJobDto, requestBody);
```

Without this:
```ts
// requestBody is: Object { company: "Acme", status: "APPLIED" }
// instanceof CreateJobDto? → false
// class-validator decorator metadata won't be read correctly for plain objects
```

With `plainToInstance`:
```ts
// dto is: CreateJobDto { company: "Acme", status: "APPLIED" }
// instanceof CreateJobDto? → true
// class-validator reads @IsString(), @MaxLength() from CreateJobDto.prototype metadata
```

**Type coercion with `@Type()`:**

Query params are always strings. `?page=2&limit=10` → `{ page: "2", limit: "10" }`.

```ts
class JobQueryDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;
}
```

`@Type(() => Number)` tells `class-transformer`: when assigning this property, call `Number(value)`. `"2"` → `2`. Without this, `@IsInt()` would reject `"2"` (it's a string, not integer).

`ParseIntPipe` on individual query params is an alternative for simpler cases. `@Type()` in a DTO class handles it uniformly for all fields.

### 12.2 `class-validator` — Decorator Internals

Each decorator calls `registerDecorator(options)` which:

```ts
Reflect.defineMetadata(
  VALIDATION_METADATA_KEY,
  [...existingValidators, newValidator],
  target,     // CreateJobDto.prototype
  propertyKey // 'company'
);
```

`validate(instance)` reads:
```ts
const validators = Reflect.getMetadata(VALIDATION_METADATA_KEY, CreateJobDto.prototype);
// For each property: run all registered validators
// Collect all failures (not short-circuit)
// Return ValidationError[]
```

**`@IsOptional()` semantics:**

`@IsOptional()` registers a validator that sets a "skip" flag when the value is `undefined | null`. Other validators on the same property check this flag:
```ts
if (value === undefined || value === null) {
  if (isOptional) return;  // skip
  // else: add "should not be empty" error
}
```

Must be declared before (in source) or annotated before other validators. In Typescript decorator evaluation order (bottom-up), `@IsOptional()` being the last-declared means it runs first (bottom-to-top order) — which is what you want: check "skip?" before checking anything else.

**`@IsEnum(JobStatus)` — Prisma integration:**

```ts
import { JobStatus } from '@prisma/client';
// JobStatus enum generated by `prisma generate` from schema:
// enum JobStatus { APPLIED INTERVIEWING OFFER REJECTED WITHDRAWN }

@IsEnum(JobStatus)
status?: JobStatus;
```

`@IsEnum(JobStatus)` validates against `Object.values(JobStatus)`. If you add a new status to the Prisma schema and regenerate, the validator automatically accepts the new value — zero DTO changes needed.

### 12.3 `ValidationPipe` Error Shape

```json
{
  "statusCode": 400,
  "message": [
    "company should not be empty",
    "company must be shorter than or equal to 200 characters",
    "status must be a valid enum value"
  ],
  "error": "Bad Request"
}
```

All errors at once. `ValidationPipe` collects all `ValidationError` instances, maps them to messages, and throws one `BadRequestException` with the full array. The client sees everything wrong in one response.

**`forbidNonWhitelisted: true` error:**
```json
{
  "message": ["property isAdmin should not exist"],
  "error": "Bad Request",
  "statusCode": 400
}
```

The caller knows their request has extra fields — catches client-side bugs early.

### 12.4 Pipe Chaining — `DefaultValuePipe` + `ParseIntPipe`

```ts
@Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number
```

Pipe chain runs left-to-right:
1. `DefaultValuePipe(1)` — if `page` query param is absent, return `1`. Otherwise pass through the string.
2. `ParseIntPipe` — convert string `"2"` to number `2`. If non-numeric: throw 400.

Without `DefaultValuePipe`: absent `page` → `undefined` → `ParseIntPipe` throws 400 → user must always provide `?page=1`. Bad UX.

Without `ParseIntPipe`: `page = "2"` (string) → `(page - 1) * limit` → `NaN * 10 = NaN` → `skip: NaN` → unexpected query behavior.

---

## 13. Security Patterns Reference

### 13.1 OWASP Top 10 Coverage

> Source: https://owasp.org/www-project-top-ten/

| Risk | Mitigation in codebase |
|------|----------------------|
| A01 Broken Access Control | Every DB query scoped to `userId`. No existence leakage. `storageKey` never sent to client. File serving validates JWT + key ownership + DB record. |
| A02 Cryptographic Failures | Passwords bcrypt(10). Refresh tokens bcrypt-hashed. JWT HS256 with 32+ char secrets enforced by Joi. HTTPS via HSTS header. |
| A03 Injection | Prisma parameterized queries everywhere. No raw SQL. File paths validated via `path.resolve` + `startsWith`. |
| A04 Insecure Design | Short-lived access tokens (15min). Refresh rotation. OAuth code exchange (tokens never in URLs). 5-layer file serving validation. |
| A05 Security Misconfiguration | Helmet headers. Strict CORS (specific origin). Swagger dev-only. Joi validates all env vars at startup. |
| A07 Auth Failures | Rate limiting (10/min on auth routes). Refresh rotation detects theft. bcrypt timing-safe comparison. Logout invalidates all sessions. |
| A09 Logging Failures | pino logs every request. Tokens redacted. Error stacks logged server-side. Enrichment errors logged with structured fields. |
| A10 SSRF | `webFetch` fetches user-provided job URLs. Risk acknowledged. Hardening: validate scheme (https only), block private IP ranges. |

### 13.2 Default-Deny Auth Architecture

```
Without JwtAuthGuard globally (default allow):
  Every new controller method → unprotected by default
  Developer must remember @UseGuards on every method
  Forgetting = security hole shipped to production

With global JwtAuthGuard (default deny):
  Every new controller method → protected by default
  Developer must @Public() to opt out
  Forgetting @Public() = broken feature (returns 401)
  → Discovered immediately in development
```

A broken feature is always preferable to a security hole. Default deny ensures the worst-case failure is an inconvenience, not a breach.

### 13.3 No-Existence-Leakage Pattern

```
findFirst({ where: { id: resourceId, userId } })

Attack scenario: User A probes job IDs belonging to User B

Without pattern:
  findUnique({ where: { id: jobId } }) → found
  if (job.userId !== userId) throw ForbiddenException()   ← 403 = exists, not yours
  Result: attacker learns "this UUID belongs to SOMEONE"

With pattern:
  findFirst({ where: { id: jobId, userId } }) → null (because userId doesn't match)
  throw NotFoundException()   ← 404 = same as nonexistent
  Result: attacker learns nothing
```

Defense against enumeration attacks. If resource IDs are UUIDs (128-bit random), enumeration is computationally infeasible anyway — but the pattern protects against ID leakage from other sources (logs, shared links, etc.).

### 13.4 Sensitive Data Never Leaves the Server

| Data | What client gets instead |
|------|--------------------------|
| Password hash | `hasPassword: boolean` |
| Refresh token | Expires and is deleted on use |
| `storageKey` | Presigned URL (time-limited) or served via auth-gated endpoint |
| `providerAccountId` | `connectedProviders: string[]` (just the provider name) |
| DB-internal IDs on some models | N/A (job UUIDs are safe to expose) |
| Error stack traces | Generic "Internal server error" |
| SQL query details | Never logged to response |

---

## 14. Interview Q&A

### "Explain the NestJS DI container."

NestJS's DI container is an IoC container. At startup it reads `@Module()` metadata (via `Reflect.getMetadata`), builds a provider dependency graph, topologically sorts it, and instantiates providers in dependency order. TypeScript's `emitDecoratorMetadata: true` causes the compiler to emit constructor parameter types as metadata (`design:paramtypes`). `@Injectable()` triggers this emission. The container reads the types at startup to know what to inject. Providers are singletons by default — one instance for the app lifetime.

### "Why use a global `JwtAuthGuard` instead of decorating each route?"

Secure-by-default. Every new route handler is automatically protected without any action from the developer. Opting out requires explicit `@Public()` — a deliberate, visible action. With per-route guards (opt-in security), a developer who forgets `@UseGuards(JwtAuthGuard)` on a new controller method ships an unprotected endpoint that could go unnoticed until a security audit. With default-deny, forgetting `@Public()` on a genuinely public route causes 401s — discovered immediately in development.

### "How does JWT refresh token rotation work and what security property does it provide?"

Each refresh token is single-use. `issueTokens()` generates a UUID (`jti`), embeds it in the refresh JWT payload, and stores a bcrypt hash in the DB under `id: jti`. On refresh: extract `jti` from the JWT, find the DB row, verify bcrypt hash, delete the row, issue a new pair. **Security property:** if an attacker steals a refresh token and uses it before the legitimate user, the legitimate user's next refresh fails (the row is gone). They're forced to re-login, signaling "your session was compromised". The attacker's stolen token is also consumed and gone.

### "Why store refresh tokens in the DB if JWTs are self-contained?"

Self-contained JWTs can't be revoked before their `exp`. If a user logs out or reports a compromised account, you can't invalidate outstanding refresh tokens without a server-side record. Storing a hash in the DB lets you: (1) immediately invalidate all sessions on logout (`deleteMany({ where: { userId } })`), (2) detect theft via rotation, (3) invalidate a specific session (`delete({ where: { id: jti } })`). The bcrypt hash means a DB breach doesn't give attackers usable tokens.

### "Why BullMQ instead of async/await for enrichment?"

Three reasons. (1) **Persistence:** Redis-backed. Server restart doesn't lose queued jobs. A plain `setImmediate` call is lost on restart. (2) **Retries:** BullMQ automatically retries on failure with configurable backoff. LLM/search APIs have transient failures; retries handle them without any code. (3) **Decoupling:** Job creation returns in < 100ms regardless of how long enrichment takes or whether it fails. The user's POST /jobs is not blocked by external API latency.

### "Explain the storage module's Strategy Pattern implementation."

`IStorageService` is the interface (contract). `LocalStorageService` and `OracleStorageService` are concrete implementations. A factory provider reads `STORAGE_DRIVER` at startup and returns one or the other, registered under the string token `STORAGE_SERVICE`. Callers inject `@Inject(STORAGE_SERVICE) private storage: IStorageService` — they never reference either concrete class. Switching from local to Oracle requires changing one env var. The pattern also makes testing trivial: inject a mock implementation under the same token.

### "How do you prevent SQL injection with Prisma?"

Prisma exclusively uses parameterized queries. Every value passed through Prisma's API (`.findMany({ where: { email } })`) is sent to PostgreSQL as a bind parameter — never string-interpolated into the SQL template. PostgreSQL's wire protocol sends the query template and parameters separately; the server parses the template once and substitutes parameters at execution time, never allowing parameter content to modify query structure.

### "How does the path traversal protection work in `serveFile`?"

Five layers: (1) `path.resolve(uploadsDir, key)` normalizes `..` traversal sequences — `'../../etc/passwd'` resolves to `/etc/passwd`. Then `startsWith(uploadsDir + path.sep)` rejects any path outside the uploads directory. The `path.sep` suffix prevents `/uploads-evil/...` from matching `/uploads/`. (2) Key structure must be exactly 4 segments starting with `resumes`. (3) The `userId` in position 1 of the key must equal `req.user.id` from JWT. (4) File must exist on disk. (5) DB record must exist. All five must pass.

### "What does `whitelist: true` protect against?"

Mass assignment attacks. Without it, any property in the request body with a matching column name in the Prisma model would reach the DB. A user could send `{ "name": "Alice", "isAdmin": true }` and if `isAdmin` is a column, Prisma would set it. `whitelist: true` makes the DTO an explicit allowlist — only decorated properties pass through. Properties not declared in the DTO are stripped before the service ever sees the request body.

### "Why does `JwtStrategy.validate()` fetch the user from DB on every request?"

To detect deleted accounts. A JWT is cryptographically valid until its `exp` claim passes (15 minutes). If a user deletes their account, their JWT would still pass signature verification. Without a DB check, deleted users could continue making API calls for up to 15 minutes. The DB check (`findUnique({ where: { id: payload.sub } })`) catches this: no user row → throw `UnauthorizedException` → 401. The trade-off: one DB query per protected request. Acceptable with connection pooling (query takes ~1ms).

### "Explain the Prisma 7 driver adapter architecture."

Prisma 7 removed the `url` field from the datasource block and introduced driver adapters. `PrismaPg` wraps the `pg` Node.js driver and implements Prisma's `DriverAdapter` interface (`queryRaw`, `executeRaw`, `startTransaction`). `PrismaClient` calls the adapter's methods instead of directly using `pg`. This enables: edge runtimes (where native `pg` doesn't work — swap to `@prisma/adapter-neon`), different PostgreSQL-compatible drivers, and better connection pool control. The CLI still has its own connection via `prisma.config.ts` — runtime adapter and CLI config are separate concerns.

### "How would you scale the enrichment system?"

Current: single worker per server instance, backed by Redis. To scale: (1) **Horizontal scale:** run more server instances — each has its own BullMQ worker. Redis coordinates via `BLMOVE`; each job is processed by exactly one worker. No code changes. (2) **Dedicated worker service:** separate the processor into a worker-only service (no HTTP). Scale enrichment workers independently of API throughput. (3) **Concurrency control:** `WorkerHost` supports `concurrency` option — each worker can process N jobs simultaneously (default 1). (4) **Rate limiting:** wrap the processor in a rate limiter (e.g., `bottleneck`) to avoid hitting Groq/Tavily rate limits when many jobs arrive simultaneously.

### "What is `reflect-metadata` and why is it required?"

`reflect-metadata` is a polyfill for the TC39 Metadata Reflection API proposal. With `emitDecoratorMetadata: true` in `tsconfig.json`, TypeScript emits constructor parameter type information as metadata:

```js
// TypeScript emits this for decorated classes:
Reflect.defineMetadata('design:paramtypes', [PrismaService, JwtService], AuthService);
```

NestJS reads this at startup to know what to inject:
```js
const deps = Reflect.getMetadata('design:paramtypes', AuthService);
// → [PrismaService, JwtService]
// Look up each in the DI container, inject them
```

Without `reflect-metadata`, NestJS can't determine constructor dependencies and throws "Can't resolve dependencies of AuthService". Without `emitDecoratorMetadata: true`, TypeScript doesn't emit the type metadata even with `reflect-metadata` polyfilled.


---

## 15. Database Schema & Relationships

> Source: https://www.prisma.io/docs/orm/prisma-schema/data-model/models
> Source: https://www.prisma.io/docs/orm/prisma-schema/data-model/relations
> Source: https://www.postgresql.org/docs/current/indexes.html

### 15.1 Entity-Relationship Overview

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                            User                                   â”‚
â”‚  id (cuid, PK)  email (unique)  password?  name  avatarUrl?      â”‚
â”‚  createdAt  updatedAt                                             â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
           â”‚ 1                         â”‚ 1                   â”‚ 1
           â”‚                           â”‚                     â”‚
           â”‚ N                         â”‚ N                   â”‚ N
    â”Œâ”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”           â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”
    â”‚     Job     â”‚           â”‚ RefreshToken  â”‚    â”‚    Account      â”‚
    â”‚  id (cuid)  â”‚           â”‚  id (jti, PK) â”‚    â”‚  id (cuid)      â”‚
    â”‚  company    â”‚           â”‚  userId (FK)  â”‚    â”‚  provider       â”‚
    â”‚  position   â”‚           â”‚  tokenHash    â”‚    â”‚  providerAcctId â”‚
    â”‚  location?  â”‚           â”‚  expiresAt    â”‚    â”‚  userId (FK)    â”‚
    â”‚  url?       â”‚           â”‚  createdAt    â”‚    â”‚                 â”‚
    â”‚  status     â”‚           â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜    â”‚  UNIQUE(        â”‚
    â”‚  priority   â”‚                                â”‚  provider,      â”‚
    â”‚  notes?     â”‚                                â”‚  providerAcctId â”‚
    â”‚  appliedAt  â”‚                                â”‚  )              â”‚
    â”‚  nextIntAt? â”‚                                â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
    â”‚  userId (FK)â”‚
    â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”˜
           â”‚ 1
     â”Œâ”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
     â”‚     â”‚                  â”‚
     â”‚ N   â”‚ 0..1             â”‚ 0..1
â”Œâ”€â”€â”€â”€â–¼â”€â”€â” â”Œâ–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”Œâ–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚JobEventâ”‚ â”‚CompanyProfile â”‚ â”‚  Resume   â”‚
â”‚ id     â”‚ â”‚  id (cuid)    â”‚ â”‚  id       â”‚
â”‚ jobId  â”‚ â”‚  jobId(unique)â”‚ â”‚  jobId    â”‚
â”‚ type   â”‚ â”‚  status       â”‚ â”‚  (unique) â”‚
â”‚from    â”‚ â”‚  industry?    â”‚ â”‚  original â”‚
â”‚Status? â”‚ â”‚  companySize? â”‚ â”‚  Name     â”‚
â”‚toStatusâ”‚ â”‚  techStack[]  â”‚ â”‚  size     â”‚
â”‚ note?  â”‚ â”‚  cultureSumm? â”‚ â”‚  storage  â”‚
â”‚created â”‚ â”‚  remotePolicy?â”‚ â”‚  Key      â”‚
â”‚  At    â”‚ â”‚  workLifeBal? â”‚ â”‚  (unique) â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â”‚  headquarters?â”‚ â”‚  created  â”‚
           â”‚  founded?     â”‚ â”‚  At       â”‚
           â”‚  errorMessage?â”‚ â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
           â”‚  enrichedAt?  â”‚
           â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜

Cardinality:
  User â”€â”€< Job            (1 user, many jobs)
  User â”€â”€< RefreshToken   (1 user, many active sessions)
  User â”€â”€< Account        (1 user, many OAuth providers)
  Job  â”€â”€< JobEvent       (1 job, many events â€” append-only log)
  Job  â”€â”€0..1 CompanyProfile  (1 job, optional 1 enrichment profile)
  Job  â”€â”€0..1 Resume          (1 job, optional 1 resume file)

All child rows cascade-delete when the parent row is deleted.
```

### 15.2 Enums

```prisma
enum JobStatus {
  WISHLIST      // job saved but not yet applied
  APPLIED       // application submitted
  INTERVIEWING  // interview stage
  OFFER         // received an offer
  REJECTED      // application rejected
  GHOSTED       // no response after application
}

enum JobPriority { LOW  MEDIUM  HIGH }

enum JobEventType {
  CREATED       // fires once when the job row is first created
  STATUS_CHANGE // fires every time status field changes
}

enum EnrichmentStatus {
  PENDING     // queued, not yet picked up by worker
  PROCESSING  // worker is actively working on it
  COMPLETED   // enrichment succeeded, fields populated
  FAILED      // enrichment failed, errorMessage set
}
```

**PostgreSQL representation:** Each Prisma enum becomes a PostgreSQL `CREATE TYPE ... AS ENUM (...)`. PostgreSQL stores enum values as strings internally but enforces the domain â€” inserting a value not in the enum throws a type error at the DB level, not just the application level. Two layers of enum validation: Prisma (application) and PostgreSQL (database).

**`JobStatus` has 6 values:** `WISHLIST` is the "saved for later" state â€” the user hasn't applied yet but wants to track the opportunity. `GHOSTED` is distinct from `REJECTED` â€” no response at all vs an explicit rejection.

**Why enums over plain strings?**
- DB-level constraint (can't insert `'typo'`)
- Type safety in TypeScript (auto-generated by `prisma generate`)
- `@IsEnum(JobStatus)` in DTOs automatically validates against these values
- Prisma's `groupBy` returns the enum value, not an arbitrary string

**`JobEventType` â€” only two types by design:** The event log captures creation and status transitions. Notes, URL updates, and other field edits are NOT logged as events â€” only the status pipeline matters for the audit trail. Keeping it simple avoids a bloated events table.

### 15.3 `User` Model

```prisma
model User {
  id        String  @id @default(cuid())
  email     String  @unique
  password  String?       // null for OAuth-only users
  name      String
  avatarUrl String?       // null for email/password users
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  jobs          Job[]
  accounts      Account[]
  refreshTokens RefreshToken[]
}
```

**`@id @default(cuid())`**

> Source: https://github.com/paralleldrive/cuid2

`cuid()` â€” Collision-resistant Unique ID. Format: `c` + 24 alphanumeric chars. Example: `cm2x9abcdefg1234567890ab`.

**cuid vs UUID comparison:**

| | cuid | UUID v4 |
|-|------|---------|
| Format | `c` prefix + alphanumeric | 8-4-4-4-12 hex with dashes |
| Length | 25 chars | 36 chars (with dashes) |
| URL-safe | Yes (no dashes) | No (has dashes) |
| Sortable | Roughly time-ordered | Random |
| Collision resistance | Very high (timestamp + fingerprint + random) | Very high (pure random) |
| Predictability | Low | Very low |

Prisma uses cuid by default for string PKs. The time-ordering property means newer rows have lexicographically larger IDs, which can slightly improve B-tree index performance for sequential inserts.

**`email String @unique`** â€” PostgreSQL creates a `UNIQUE` index on `email`. Enforces one account per email at the DB level. `findUnique({ where: { email } })` uses this index directly â€” O(log n) lookup.

**`password String?` â€” nullable:** OAuth-only users have `password: null`. Email/password users have a bcrypt hash. `String?` in Prisma â†’ `TEXT` column in PostgreSQL with `NULL` allowed. `NOT NULL` would require a placeholder value for OAuth users â€” semantically wrong.

**`avatarUrl String?`** â€” populated from Google/GitHub profile during OAuth. `null` for email/password users (unless they set one via `updateProfile`).

**`@updatedAt`** â€” Prisma automatically sets this to `NOW()` on every `UPDATE`. You never set it manually. PostgreSQL doesn't have native `ON UPDATE` semantics â€” Prisma adds this via the generated client (it includes `updatedAt` in every update statement). Useful for "last modified" displays and cache invalidation.

**Relation fields (`jobs`, `accounts`, `refreshTokens`)** â€” these are NOT database columns. They're virtual Prisma fields that describe the relationship to other tables. At the DB level, the foreign key lives on the child table (`Job.userId`, `Account.userId`, `RefreshToken.userId`). These virtual fields enable `prisma.user.findUnique({ include: { jobs: true } })`.

### 15.4 `RefreshToken` Model

```prisma
model RefreshToken {
  id        String   @id          // NOT @default(cuid()) â€” set explicitly to jti
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([userId])
}
```

**`@id` without `@default`:**

The `id` is the JWT's `jti` claim (a `randomUUID()` from `crypto`). Set explicitly in `issueTokens()`:
```ts
await this.prisma.refreshToken.create({ data: { id: jti, ... } });
```

This is a deliberate design: the `jti` in the JWT payload IS the DB row's primary key. Looking up a refresh token: decode JWT â†’ get `jti` â†’ `findUnique({ where: { id: jti } })`. One lookup, no scan.

**`tokenHash String`** â€” bcrypt hash of the raw refresh JWT string. The raw token is never stored. If the DB is compromised, attackers get hashes â€” can't use them directly to call `/auth/refresh`.

**`expiresAt DateTime`** â€” mirrors the JWT's `exp` claim. The DB field exists as a belt-and-suspenders check beyond JWT expiry. The service checks `stored.expiresAt < new Date()` in addition to Passport's signature + expiry verification.

**`@@index([userId])`** â€” composite index on `userId`. Used by:
- `deleteMany({ where: { userId } })` during logout (delete all sessions)
- (Any query filtering refresh tokens by user)

Without this index, logout scans the entire `RefreshToken` table for matching `userId` values â€” a full table scan. With index: O(log n) lookup per row, then range scan of matching rows.

**`onDelete: Cascade`** â€” when a `User` row is deleted, all their `RefreshToken` rows are automatically deleted by PostgreSQL. No orphaned tokens from deleted accounts.

**Multiple rows per user = multiple active sessions:**

One user can have many `RefreshToken` rows simultaneously (one per device/browser). `logout()` does `deleteMany({ where: { userId } })` â€” kills all sessions. For single-device logout, you'd `delete({ where: { id: jti } })` using the current session's token.

### 15.5 `Account` Model

```prisma
model Account {
  id                String @id @default(cuid())
  provider          String         // 'google' | 'github'
  providerAccountId String         // Google's user ID for this person
  userId            String
  user              User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}
```

**Purpose:** Links OAuth identities to internal `User` rows. Separates "who Google says you are" from "who you are in our system".

**`@@unique([provider, providerAccountId])`** â€” compound unique constraint. Prevents the same Google account from being linked to two different users. In `handleOAuthUser`:

```ts
prisma.account.findUnique({
  where: { provider_providerAccountId: { provider, providerAccountId } }
})
```

`provider_providerAccountId` is Prisma's auto-generated accessor name for this compound unique â€” follows the pattern `{field1}_{field2}`.

**Why separate `Account` model instead of columns on `User`?**

If you stored `googleId` and `githubId` directly on `User`, adding a third provider (e.g., LinkedIn) requires a new column migration. The `Account` model is open-closed â€” adding a new provider is inserting rows, not altering the schema.

Also: one user linking 3 providers has 3 `Account` rows and 1 `User` row. With provider columns on `User`, a user can only ever have one Google account linked (one `googleId` column). The `Account` model allows any number of providers.

**`provider String`** â€” not an enum in Prisma because Passport strategy names are strings and adding a new provider shouldn't require a migration. Enforced at the application layer by the strategy implementations.

**`onDelete: Cascade`** â€” deleting a `User` deletes all linked `Account` rows. A user who deletes their account has their OAuth linkages cleaned up automatically.

### 15.6 `Job` Model

```prisma
model Job {
  id              String      @id @default(cuid())
  company         String
  position        String
  location        String?
  url             String?
  status          JobStatus   @default(APPLIED)
  priority        JobPriority @default(MEDIUM)
  notes           String?
  appliedAt       DateTime    @default(now())
  nextInterviewAt DateTime?
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt
  userId          String
  user            User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  events          JobEvent[]
  companyProfile  CompanyProfile?
  resume          Resume?

  @@index([userId])
  @@index([userId, status])
  @@index([userId, appliedAt])
  @@index([userId, createdAt])
}
```

**`status JobStatus @default(APPLIED)`** â€” if no status provided at creation, defaults to `APPLIED`. The `@default` in Prisma â†’ `DEFAULT 'APPLIED'` in PostgreSQL. If the client doesn't send `status`, the DB fills it in.

**`appliedAt DateTime @default(now())`** â€” when the application was submitted. Distinct from `createdAt` â€” you might enter a job into the tracker days after actually applying. The API accepts `appliedAt` as an optional override; if absent, defaults to now. `createdAt` is always "when the row was inserted", not editable.

**`nextInterviewAt DateTime?`** â€” nullable. Set when an interview is scheduled. Cleared (set to `null`) if the interview is cancelled. The `UpdateJobDto` handles `null` explicitly:
```ts
nextInterviewAt:
  dto.nextInterviewAt !== undefined
    ? dto.nextInterviewAt
      ? new Date(dto.nextInterviewAt)
      : null       // explicitly nulling the field
    : undefined    // not in the request â€” don't change it
```
The three-way distinction: `undefined` (not in request, don't touch), `null` (explicitly clear), string (set new date).

**`url String?`** â€” the job posting URL. Optional (some jobs are found via recruiters with no URL). Also used by the enrichment processor to fetch the job listing page for context.

**`onDelete: Cascade`** â€” deleting a `User` cascades to `Job` rows. This then cascades further: `JobEvent`, `CompanyProfile`, and `Resume` rows all have `onDelete: Cascade` on their `Job` foreign key. The full cascade tree:

```
DELETE User
  â†’ DELETE Job (cascade from User)
    â†’ DELETE JobEvent (cascade from Job)
    â†’ DELETE CompanyProfile (cascade from Job)
    â†’ DELETE Resume (cascade from Job)
  â†’ DELETE Account (cascade from User)
  â†’ DELETE RefreshToken (cascade from User)
```

One `DELETE FROM "User" WHERE id = $1` triggers all of this via PostgreSQL's foreign key cascade mechanism â€” no application-level cleanup code needed (except the storage file for Resume, which the app handles separately).

#### Indexes â€” Deep Dive

```prisma
@@index([userId])
@@index([userId, status])
@@index([userId, appliedAt])
@@index([userId, createdAt])
```

**Why 4 separate indexes, not one composite index covering all?**

PostgreSQL B-tree indexes can only be used when the query's WHERE clause and ORDER BY match a **left-prefix** of the index. Four targeted indexes serve four different query patterns:

**`@@index([userId])`**

Used by: `DELETE FROM "Job" WHERE user_id = $1` (account deletion cascade), `SELECT COUNT(*) WHERE user_id = $1` (stats), any query filtered by userId only.

**`@@index([userId, status])`**

Used by: `findAll` when filtering by status:
```sql
WHERE user_id = $1 AND status = $2
```
Also used by `groupBy`:
```sql
SELECT status, COUNT(*) WHERE user_id = $1 GROUP BY status
```
The index covers both columns in the WHERE â†’ index-only scan for the group-by (PostgreSQL can answer the query from the index without touching the heap).

**`@@index([userId, appliedAt])`**

Used by: `findAll` with `sortBy='appliedAt'` (the default):
```sql
WHERE user_id = $1 ORDER BY applied_at DESC
```
PostgreSQL can traverse the `(userId, appliedAt)` index in reverse order to produce the sorted result without a sort step. Also used for date-range filters:
```sql
WHERE user_id = $1 AND applied_at >= $2 AND applied_at <= $3
```

**`@@index([userId, createdAt])`**

Used by: `findAll` with `sortBy='createdAt'`. Same pattern as above but for creation time.

**What happens without these indexes:**

For a user with 1000 jobs, `findAll` with no index:
- Full table scan of `jobs`
- Filter by `userId` (discard ~all rows that aren't this user's)
- Sort remaining rows by `appliedAt`
- Apply `OFFSET` and `LIMIT`

With index `(userId, appliedAt)`:
- B-tree index lookup: find the range of rows where `userId = X`
- Rows are already in `appliedAt` order (the index stores them sorted)
- Skip to the `OFFSET` position within that range (O(log n))
- Take `LIMIT` rows

The difference matters at scale. For a personal app with 200 jobs, it's negligible. But demonstrating you understand indexes in interviews is valuable.

### 15.7 `JobEvent` Model

```prisma
model JobEvent {
  id         String       @id @default(cuid())
  jobId      String
  job        Job          @relation(fields: [jobId], references: [id], onDelete: Cascade)
  type       JobEventType
  fromStatus JobStatus?   // null for CREATED events
  toStatus   JobStatus    // always set â€” what status resulted from this event
  note       String?      // reserved for future use (manual notes on events)
  createdAt  DateTime     @default(now())

  @@index([jobId])
  @@map("job_events")
}
```

**Append-only audit log:** Events are never updated or deleted individually (only cascade-deleted with the job). Each row is a historical record: "at `createdAt`, this job transitioned from `fromStatus` to `toStatus`".

**`fromStatus JobStatus?`**

`null` for `CREATED` events â€” there's no "previous status" for a newly created job. Non-null for `STATUS_CHANGE` events.

**Why `toStatus` is not nullable:**

Every event must have a resulting status. `CREATED` events: `toStatus = initialStatus`. `STATUS_CHANGE` events: `toStatus = dto.status`. The invariant: you can always reconstruct the current status by replaying events (find the latest `toStatus`).

**`@@map("job_events")`**

Prisma model name: `JobEvent`. Actual PostgreSQL table name: `job_events`. Prisma defaults to the model name for table naming. `@@map` overrides this to use snake_case for the DB (convention for PostgreSQL) while keeping PascalCase in the Prisma/TypeScript layer.

Without `@@map`: table would be `"JobEvent"` (quoted, case-sensitive in PostgreSQL). With `@@map("job_events")`: table is `job_events` (no quoting needed, lowercase).

**`@@index([jobId])`**

`getEvents(userId, jobId, page, limit)` queries:
```sql
SELECT * FROM job_events WHERE job_id = $1 ORDER BY created_at ASC LIMIT $2 OFFSET $3
```
Index on `jobId` â†’ jump directly to events for this job instead of full table scan.

**Reconstructing history from events:**

```ts
// Replay to get current status:
const events = await prisma.jobEvent.findMany({
  where: { jobId },
  orderBy: { createdAt: 'asc' }
});
const currentStatus = events[events.length - 1].toStatus;
// Equals Job.status (kept in sync by the nested-write pattern)
```

The `Job.status` field is the materialized current state. The `events` table is the log. They're kept in sync by always writing both in the same transaction.

### 15.8 `CompanyProfile` Model

```prisma
model CompanyProfile {
  id              String           @id @default(cuid())
  jobId           String           @unique   // 1:1 with Job
  job             Job              @relation(fields: [jobId], references: [id], onDelete: Cascade)
  status          EnrichmentStatus @default(PENDING)
  industry        String?
  companySize     String?
  techStack       String[]         // PostgreSQL TEXT[] array
  cultureSummary  String?
  remotePolicy    String?
  workLifeBalance String?
  headquarters    String?
  founded         String?
  errorMessage    String?
  enrichedAt      DateTime?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  @@map("company_profiles")
}
```

**`jobId String @unique`** â€” enforces 1:1 with `Job`. `@unique` creates a `UNIQUE` constraint on `job_id`. One job can have at most one `CompanyProfile`. Prisma models this as `Job.companyProfile` being optional (returns null if not enriched yet).

**`status EnrichmentStatus @default(PENDING)`** â€” tracks the enrichment state machine. The UI uses this to show loading/success/error states without polling the job object.

**`techStack String[]`** â€” PostgreSQL native array type (`TEXT[]`). Prisma maps `String[]` to PostgreSQL `TEXT[]`. Stored as `{ 'TypeScript', 'React', 'PostgreSQL' }` in the column. No JSON encoding needed.

**Why `String[]` instead of a separate `TechStackItem` table?**

A separate table would normalize the data but add complexity (JOIN on every enrichment fetch, insert N rows per enrichment). Tech stack items for a job have no independent identity or relations â€” they're just a list of strings attached to a `CompanyProfile`. PostgreSQL arrays are the right tool for this.

**All enriched fields are `String?`** â€” nullable. Before enrichment runs, all fields are null. After `COMPLETED`, they contain LLM-extracted values or `'Unknown'` (from the `sanitize()` function). `founded` is a string, not an integer, because "1998" is simple to store and doesn't need arithmetic.

**`errorMessage String?`** â€” populated only on `FAILED` status. Contains the sanitized error message (URLs stripped, truncated to 200 chars). The UI can display why enrichment failed.

**`enrichedAt DateTime?`** â€” set when enrichment `COMPLETED`. `null` while pending/processing/failed. The UI can show "enriched 2 hours ago" vs "pending".

**`@@map("company_profiles")`** â€” same snake_case convention as `job_events`.

### 15.9 `Resume` Model

```prisma
model Resume {
  id           String   @id @default(cuid())
  jobId        String   @unique   // 1:1 with Job
  job          Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
  originalName String
  size         Int      // bytes
  storageKey   String   @unique
  createdAt    DateTime @default(now())
}
```

**`jobId String @unique`** â€” 1:1 with `Job`. One resume per job application. `upsert` is used for uploads â€” if a `Resume` already exists for this `jobId`, update it; otherwise create it.

**`originalName String`** â€” the sanitized filename the user uploaded. Used in:
- Response DTO (display name in UI)
- `Content-Disposition` header when serving: `attachment; filename="originalName"`

Never used for storage (storage uses the key). Never allows path traversal (sanitized on upload).

**`size Int`** â€” file size in bytes. Displayed in UI ("452 KB"). Also logged for debugging.

**`storageKey String @unique`** â€” the internal storage key (`resumes/<userId>/<jobId>/<uuid>.pdf`). `@unique` prevents two `Resume` rows pointing to the same file (unlikely, but belt-and-suspenders). Never returned to clients â€” only used server-side to call `storage.getPresignedUrl(key)` or `storage.delete(key)`.

**No `updatedAt`** â€” resumes are replaced, not updated in place. When a new resume is uploaded for the same job, the `upsert` updates `originalName`, `size`, and `storageKey` â€” creating a new file with a new key. The `createdAt` reflects when the current resume was first created for this job; there's no meaningful "last updated" since the whole file changes on replace.

### 15.10 Cascade Delete â€” Full Tree

```prisma
// All child models have:
onDelete: Cascade
```

PostgreSQL evaluates cascade deletes in dependency order. When `DELETE FROM "User" WHERE id = $1` runs:

```
1. PostgreSQL finds all referencing tables with CASCADE
2. For each referencing row: delete it (which may trigger further cascades)

Tree of cascades:
User deleted
â”œâ”€â”€ Job rows (userId FK, Cascade)
â”‚   â”œâ”€â”€ JobEvent rows (jobId FK, Cascade)
â”‚   â”œâ”€â”€ CompanyProfile rows (jobId FK, Cascade)
â”‚   â””â”€â”€ Resume rows (jobId FK, Cascade)
â”‚       â””â”€â”€ [storageKey file â€” handled in application code, not DB]
â”œâ”€â”€ Account rows (userId FK, Cascade)
â””â”€â”€ RefreshToken rows (userId FK, Cascade)
```

**Why cascade at the DB level (not application code)?**

If you handle deletion in application code:
```ts
// Fragile application-level cleanup:
await prisma.jobEvent.deleteMany({ where: { job: { userId } } });
await prisma.companyProfile.deleteMany({ where: { job: { userId } } });
await prisma.resume.deleteMany({ where: { job: { userId } } });
await prisma.job.deleteMany({ where: { userId } });
await prisma.account.deleteMany({ where: { userId } });
await prisma.refreshToken.deleteMany({ where: { userId } });
await prisma.user.delete({ where: { id: userId } });
```

Problems:
- If any step fails mid-way, data is partially deleted (inconsistent)
- Each step is a separate DB round-trip
- Adding a new child model requires remembering to add it here

DB cascade runs atomically in one transaction. PostgreSQL handles all child deletions before committing. The application only needs `prisma.user.delete()`.

**The one exception â€” storage files:**

The `Resume.storageKey` points to a file in storage (disk or OCI). PostgreSQL can't delete storage files â€” the application must do it. The cascade deletes the DB row; the app separately calls `storage.delete(storageKey)` fire-and-forget. This is why `JobsService.remove` pre-fetches the `storageKey` before deleting the job.

### 15.11 `prisma.config.ts` â€” CLI vs Runtime Connection

```ts
// backend/prisma.config.ts
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
```

**Two separate connection paths:**

| | CLI (migrations) | Runtime (application) |
|-|-----------------|----------------------|
| Connection source | `prisma.config.ts` | `PrismaPg` adapter in `PrismaService` |
| User | `DATABASE_URL` (often admin/owner) | `DATABASE_URL` (same here, but could differ) |
| When used | `prisma migrate dev`, `prisma generate`, `prisma studio` | During HTTP request handling |
| Type | Synchronous config file | Adapter instance created at startup |

In production you might use different credentials: the CLI uses a migration user with `ALTER TABLE` permissions; the runtime uses an application user with only `SELECT/INSERT/UPDATE/DELETE`. `prisma.config.ts` enables this separation.

**`import 'dotenv/config'`** â€” the CLI runs in Node.js but outside the NestJS application context. NestJS's `ConfigModule` isn't active. `dotenv/config` loads `.env` so `process.env.DATABASE_URL` is available when the CLI reads the config.

**`schema: 'prisma/schema.prisma'`** â€” Prisma 7 supports multiple schema files. This points the CLI to the single schema file. Without it, Prisma looks for the default location (`prisma/schema.prisma`) anyway, but explicit is better for clarity.

### 15.12 ID Strategy â€” cuid vs UUID vs Auto-Increment

All models use `@id @default(cuid())` (except `RefreshToken` which uses a manually-set UUID/jti).

**Auto-increment integers (not used here):**
```prisma
id Int @id @default(autoincrement())
```
- Simple, small (4 bytes)
- Expose row count in URLs (`/jobs/1`, `/jobs/2` â†’ reveals you have 2 jobs)
- Predictable/enumerable â€” attacker can try sequential IDs
- Doesn't work in distributed systems (two servers could generate the same integer)

**UUID v4 (alternative):**
```prisma
id String @id @default(uuid())
```
- 36 chars (with dashes), 128 bits of randomness
- Globally unique, not enumerable
- Not time-ordered â€” random inserts cause B-tree index fragmentation

**cuid (chosen):**
- 25 chars, URL-safe (no dashes)
- Time-ordered component â†’ sequential inserts have good B-tree locality
- Still opaque/non-enumerable
- Prisma's default recommendation

**Why `RefreshToken.id` is set manually:**

The `id` is the `jti` from the JWT. We need the JWT's `jti` to match the DB row's `id` so we can do a direct PK lookup. If Prisma generated the `id` (cuid), we'd need to also store `jti` as a separate field and add an index on it. Using `jti` as the PK directly combines two things into one â€” simpler and one less index.

### 15.13 Nullable vs Non-Nullable Fields â€” Design Decisions

| Model | Field | Nullable? | Reason |
|-------|-------|-----------|--------|
| User | password | Yes `?` | OAuth users have no password |
| User | avatarUrl | Yes `?` | Email/password users may not have one |
| Job | location | Yes `?` | Remote jobs have no location |
| Job | url | Yes `?` | Recruiter-sourced jobs may have no URL |
| Job | notes | Yes `?` | Free-text, optional |
| Job | nextInterviewAt | Yes `?` | No interview scheduled yet |
| JobEvent | fromStatus | Yes `?` | `CREATED` events have no prior status |
| JobEvent | note | Yes `?` | Reserved for future manual notes |
| CompanyProfile | all enriched fields | Yes `?` | Not available until enrichment completes |
| CompanyProfile | errorMessage | Yes `?` | Only set on `FAILED` |
| CompanyProfile | enrichedAt | Yes `?` | Only set on `COMPLETED` |
| Resume | (none nullable) | â€” | Everything is required when a resume exists |

**Principle:** nullable = "this information may legitimately not exist". Non-nullable = "this must always be known". `Job.company` is non-nullable â€” every job has a company. `Job.url` is nullable â€” not every job has a posting URL.

**PostgreSQL storage:** Non-nullable columns have `NOT NULL` constraints at the DB level. Inserting a `NULL` into a non-nullable column throws a constraint violation error. Prisma enforces this at the type level (TypeScript will complain if you try to pass `undefined`/`null` to a non-nullable field in a create call).

### 15.14 `@@map` â€” Prisma Model Name vs Table Name

```prisma
model CompanyProfile { @@map("company_profiles") }
model JobEvent       { @@map("job_events") }
```

**Why the discrepancy?**

Prisma convention: model names are PascalCase (`CompanyProfile`). SQL convention: table names are snake_case (`company_profiles`). Without `@@map`, Prisma creates the table with the model name as-is: `"CompanyProfile"` (quoted, case-sensitive in PostgreSQL).

Problems with quoted identifiers:
- Every query needs the exact case: `SELECT * FROM "CompanyProfile"` â€” `company_profile` would fail
- DBA tools, `psql`, raw SQL queries all need to remember the exact casing
- Less idiomatic for PostgreSQL

With `@@map`: the table is `company_profiles` (lowercase, unquoted, idiomatic PostgreSQL). The Prisma model is still `CompanyProfile` in TypeScript.

`Job`, `User`, `Account`, `Resume` don't use `@@map` â€” their names happen to be idiomatic as both Prisma models and PostgreSQL tables (single English words, no awkward casing).

### 15.15 Reading the Schema in Migrations

Migrations live in `backend/prisma/migrations/`. Each migration is:

```
prisma/migrations/
  20241115123456_init/
    migration.sql       â† raw SQL Prisma generated
  20241120093012_add_enrichment/
    migration.sql
```

`migration.sql` is plain PostgreSQL DDL:
```sql
-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('WISHLIST', 'APPLIED', 'INTERVIEWING', 'OFFER', 'REJECTED', 'GHOSTED');

-- CreateTable
CREATE TABLE "Job" (
  "id" TEXT NOT NULL,
  "company" TEXT NOT NULL,
  "status" "JobStatus" NOT NULL DEFAULT 'APPLIED',
  "userId" TEXT NOT NULL,
  -- ...
  CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Job_userId_idx" ON "Job"("userId");
CREATE INDEX "Job_userId_status_idx" ON "Job"("userId","status");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Each migration file is a historical record. Prisma stores which migrations have run in a `_prisma_migrations` table. `prisma migrate dev` compares the schema file to the last migration and generates a new one for any differences.

**`ON UPDATE CASCADE`** â€” Prisma adds this automatically. If a `User.id` were updated (it won't be â€” cuid is immutable by convention), the FK columns in child tables would update too. Harmless but present in all FK constraints.
