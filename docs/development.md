# Development

- [Gates](#gates)
- [CI](#ci)
- [Tests](#tests)
- [Examples](#examples)
- [Source layout](#source-layout)
- [Contributing](#contributing)
- [Scope](#scope)

---

## Gates

```sh
npm install

npm test           # vitest run — 143 tests, no credentials or network needed
npm run test:watch # vitest in watch mode
npm run typecheck  # tsc over src, test and examples, including the type-level tests
npm run lint       # eslint
npm run format     # prettier --write .
npm run format:check
npm run build      # tsup → dist (ESM, CJS, .d.ts)
npm run dev        # tsup --watch
```

`prepublishOnly` runs `typecheck && test && build`, so the same checks gate a publish.

## CI

`.github/workflows/ci.yml` runs on every push and pull request against `main`, and on demand via
`workflow_dispatch`. Three independent jobs:

| Job       | Node       | Runs                                |
| --------- | ---------- | ----------------------------------- |
| `quality` | 24         | `typecheck`, `lint`, `format:check` |
| `test`    | 22.x, 24.x | `test`                              |
| `build`   | 24         | `build`                             |

The jobs are independent so a lint failure does not mask a test failure. `fail-fast` is off, so a
failure is reported on every matrix version. Superseded runs are cancelled automatically.

## Tests

```text
test/
├── schema.test.ts          question builders and their argument validation
├── decision.test.ts        validateDecision / canonicalizeDecision, and order preservation
├── response.test.ts        the provider-response boundary, and pair narrowing
├── result.test.ts          result behaviour through the boundary
├── engine.test.ts          provider calls, timeouts, error paths
├── mock.test.ts            MockProvider defaults and responder
├── jev-client.test.ts      HTTP, configuration, parsing, cancellation
├── jev-mapper.test.ts      translation and score level-index remapping
├── jev-provider.test.ts    credentials, wire requests, neutral results
├── json.test.ts            JSON state acceptance and rejection
├── types.test.ts           compile-time inference guarantees
├── public-api.test.ts      the public export surface
└── definition-of-done.test.ts  the documented flow, end to end
```

Type inference is treated as a product feature, so `types.test.ts` asserts it explicitly with
`@ts-expect-error` and exact-identity checks validated by `tsc` — not by a runtime assertion library.
`npm run typecheck` fails if a value union is ever widened or if an invalid value stops being
rejected. `public-api.test.ts` fails if provider internals or engine internals are ever re-exported.

The Jev client is tested entirely against an injected `fetch`, so the suite needs no credentials and
no network.

## Examples

`examples/` holds five programs, type-checked by `npm run typecheck`:

| File                  | Shows                                               |
| --------------------- | --------------------------------------------------- |
| `support-decision.ts` | The decision and state shared by the other examples |
| `support-triage.ts`   | The full loop with `MockProvider`                   |
| `jev-provider.ts`     | The same decision with `JevProvider`                |
| `custom-provider.ts`  | Implementing `DecisionProvider` yourself            |
| `error-handling.ts`   | Timeouts, malformed responses, configuration errors |

They import from `../src/index` rather than `"decimo"` so they always match the current source
without a build step, and are not wired into a run script.

## Source layout

| Path                                          | Responsibility                                         |
| --------------------------------------------- | ------------------------------------------------------ |
| `src/index.ts`                                | Public surface; provider internals stay private        |
| `src/core/decision.ts`                        | Decision/result types; validate → canonicalize         |
| `src/core/response.ts`                        | The provider-response boundary                         |
| `src/core/result.ts`                          | Pure result construction                               |
| `src/core/engine.ts`                          | Orchestration, timeout, error wrapping                 |
| `src/core/errors.ts`                          | Error hierarchy                                        |
| `src/schema/types.ts`                         | Public question types and builder argument validation  |
| `src/schema/canonical.ts`                     | Decimo's canonical questions, answers and `AnswerPair` |
| `src/schema/{boolean,categorical,ordinal}.ts` | Question builders                                      |
| `src/providers/provider.ts`                   | The provider port, in canonical terms                  |
| `src/providers/mock.ts`                       | `MockProvider`                                         |
| `src/providers/jev/`                          | `JevProvider`: client, mapper, wire types              |
| `src/types/json.ts`                           | JSON state types and runtime checks                    |
| `src/types/http.ts`                           | Injectable transport types                             |

See [architecture.md](./architecture.md) for how these interact.

## Contributing

- Report bugs and propose features via
  [GitHub issues](https://github.com/Vedant0898/Decimo/issues).
- Run the five gates before opening a pull request. CI runs the same ones, but catching a failure
  locally is faster than a CI round-trip.
- New behaviour needs coverage in `test/`. A change to inference or to the public surface also needs
  a matching change in `types.test.ts` or `public-api.test.ts`.
- Keep the provider boundary clean: provider wire formats belong in `src/providers/<name>/`, and the
  public surface should expose only that provider's constructor and options.
- Format with `npm run format` rather than hand-editing style.

Documentation lives in `docs/`:

| Document                             | Audience                               |
| ------------------------------------ | -------------------------------------- |
| [api.md](./api.md)                   | Users writing code against the library |
| [providers.md](./providers.md)       | Users choosing or writing a provider   |
| [architecture.md](./architecture.md) | Contributors                           |
| `examples/`                          | Everyone                               |

## Scope

Deliberately not built yet:

- a policy or rules engine
- model routing logic
- calibration of reported probabilities
- an evaluation dashboard
- persistent caching
- an observability platform
- more than one external provider
- distributed infrastructure
- a prompt or DSL system

Each `evaluate()` is a single provider call, and nothing is persisted. Build what you need on top.

### Potential directions

Not committed and not scheduled — just the directions the current design points toward:

- batching several decisions into one provider call
- composing several questions into a single higher-level decision
- further provider adapters
- runtime inspection tooling for results
