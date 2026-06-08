# Small Model Codex-Augmentation Testing

## Models Tested

| Model | Size | Role Tested | Tool Support | Notes |
|-------|------|-------------|-------------|-------|
| `qwen3.5-9b-deepseek-v4-flash` | 9B | Executor | ✅ | Baseline — best quality |
| `microsoft/phi-4-mini-reasoning` | 3.8B | Planner, Executor, Reviewer | ✅ (tools OK) | Good planner, failed as executor |
| `google/gemma-4-12b-it` | 12B | Executor, Reviewer | ❌ (template bug) | Broken Jinja template in this LM Studio — can't use `tools` param |
| `microsoft/phi-4-reasoning-plus` | 14.7B | — | ✅ | Available but not yet tested |
| `qwen3.5-2b-kimi-and-opus-distillation-i1` | 2B | Executor | ✅ | Too small — produced descriptions, not code |

---

## Test Results

### test2 — Baseline (qwen3.5-9b executor, no planner/reviewer)

**Config:** Executor: qwen3.5-9b | Planner: default | Reviewer: off | Codex: on

**Prompt:** *"Create a LoadingSkeleton React component with shimmer animation, shape variants, and Suspense integration"*

**Output:** 3 files — all clean, working code
- `Skeleton.tsx` — Unified component with `rounded`/`sharp`/`gradient-bar` variants, `React.memo`
- `SuspenseSkeleton.tsx` — Suspense wrapper
- `Skeleton.css` — Shimmer keyframes with variant classes

**Quality:** Excellent. All imports correct, runtime-safe, proper TypeScript, clean architecture.

**Verdict:** 🏆 **Gold standard.** Focused plan, tight execution.

---

### test5 — phi-4-mini planner + qwen3.5-9b executor

**Config:** Planner: phi-4-mini-reasoning | Executor: qwen3.5-9b | Reviewer: off | Codex: on

**Issue encountered:** phi-4-mini outputs thinking tokens + markdown-wrapped JSON. Initial JSON parse failed. Fixed via `extractJson()` in `json-repair.ts`.

**Output:** 8 files
- ✅ `LoadingSkeleton.css` — Proper `::after` shimmer with `skewX(-25deg)`
- ✅ `SVGShapes.tsx` — 10 SVG shape variants (creative, well-typed)
- ✅ `useLazyLoader.js` — Clean React hook
- ✅ `LoaderWrapper.js` — Suspense integration
- ⚠️ `Shimmer.js` — Uses `$shimmer` (SCSS syntax), missing CSS import
- ❌ `Card.js` — Broken CSS variable references (`var(--shimmer-velocity)`), syntax errors in gradient template literals
- ❌ `Circle.js` — 3 lines saying "implementation complete" with no code
- ❌ `Box.js` — Empty file

**Quality:** Mixed. The **planner worked fine** (scope was too broad: 8 tasks across 3 milestones including "Testing & Documentation"). Executor spread thin; produced stubs and broken components.

**Verdict:** ⚠️ **Planner works, executor quality regressed due to over-scoped plan.** Better than test7 but below test2.

---

### test6 — gemma-4-e4b executor (not documented in detail)

Ran briefly, produced descriptions instead of code (consistent with other sub-9B models).

---

### test7 — Full phi-4-mini-reasoning stack

**Config:** Planner: phi-4-mini-reasoning | Executor: phi-4-mini-reasoning | Reviewer: phi-4-mini-reasoning | Codex: on

**Issue encountered:** Milestone `description` field missing from planner JSON output — fixed with fallback `m.description || m.title`.

**Output:** 1 file (6 characters): `circle.html` containing `<div id=`

All tasks reported "completed" — the phi-4-mini reviewer approved the garbage output.

**Quality:** Utter failure. 3.8B model cannot generate meaningful code.

**Verdict:** ❌ **phi-4-mini-reasoning cannot execute code generation. Reviewer at 3.8B also can't detect broken output.**

---

### test8 — phi-4-mini planner + gemma-4-12b-it executor + reviewer

**Config:** Planner: phi-4-mini-reasoning | Executor: gemma-4-12b-it | Reviewer: gemma-4-12b-it | Codex: on

**Issue encountered:** `gemma-4-12b-it` has a broken Jinja prompt template in this LM Studio version. When the `tools` parameter is included in the API request, LM Studio returns:

> `400 Error rendering prompt with jinja template: "Cannot call something that is not a function: got UndefinedValue"`

This is an LM Studio model template bug — the template references a function (likely `raise_exception`) that is not defined in the Jinja environment. Models without the `tools` parameter (planner, reviewer roles) work fine.

**Manual testing confirmed:**
- Long system prompts (6k+ tokens) → ✅ fast (~2.7s)
- `tools` parameter → ❌ Jinja error
- No tools (simple chat) → ✅ works
- AGENTS.md content included → ✅ works

**Verdict:** ❌ **gemma-4-12b-it cannot serve as executor on this LM Studio version** (tools parameter unsupported). Would work as planner or reviewer (no tools needed).

---

## Key Findings

### 1. Model Size Threshold
- **< 9B models** (2B, 3.8B, 4B): Cannot reliably generate code. Output descriptions, stubs, or broken files.
- **9B (qwen3.5-9b)**: Minimum viable executor. Clean, working code generation.
- **12B+ (gemma-4-12b-it, phi-4-reasoning-plus)**: Could potentially improve over 9B — untested for code gen due to tool support issues.

### 2. phi-4-mini-reasoning as Planner (3.8B) — ✅ Works
- Produces reasonable mission plans
- Outputs thinking tokens before JSON — fixed by `extractJson()` 
- Sometimes outputs markdown-wrapped JSON blocks — handled by `repairJson()`
- May omit `description` field on milestones — fixed by fallback in mission-planner.ts
- May use invalid `type` values (e.g., `"design"` instead of `"code"`) — fixed by type whitelist fallback
- Safe to use as lightweight planner, saving the bigger model for execution

### 3. Tools Parameter Limitation (gemma-4-12b-it)
- Model shows "Tools" icon in LM Studio, indicating tool-calling training
- But the Jinja prompt template in this LM Studio version has a bug rendering the `tools` parameter
- **Workaround:** Use gemma only for roles that don't need tools (planner, reviewer), or fix the prompt template in LM Studio UI (`My Models > Model Settings > Prompt Template`)

### 4. phi-4-reasoning-plus (14.7B) — Handles tools ✅
- Available on LM Studio at `microsoft/phi-4-reasoning-plus`
- Tested with `tools` parameter — no Jinja errors
- Largest model available — potential single-model solution

---

## Code Changes Made

| Change | File | Purpose |
|--------|------|---------|
| `extractJson()` | `src/agent/json-repair.ts` | Strip thinking tokens and extract JSON from reasoning model output |
| `repairJson()` | `src/agent/json-repair.ts` | Remove markdown fences, trailing commas, close unmatched braces |
| `max_tokens: 4096` | `src/agent/mission-planner.ts` | Prevent planner output truncation |
| `description` fallback | `src/agent/mission-planner.ts` | `m.description || m.title` for phi-4-mini's missing description |
| `type` whitelist | `src/agent/mission-planner.ts` | Default unknown types to `"code"` |
| Env-configurable paths | `src/mcp/codex-service.ts` | `CODEX_SCRIPT_PATH` / `CODEX_PYTHON_PATH` |
| Path validation | `src/mcp/codex-service.ts` | WARN logs for missing script/python |
| Review retry fix | `src/agent/scheduler.ts` | Removed premature `userGuidance = undefined` clear |

---

## Next Test Candidates

| Stack | Planner | Executor | Reviewer | Rationale |
|-------|---------|----------|----------|-----------|
| **test9** | phi-4-mini (3.8B) | **phi-4-reasoning-plus (14.7B)** | gemma-4-12b-it | Tests 14.7B executor vs 9B baseline |
| — | phi-4-mini (3.8B) | qwen3.5-9b | gemma-4-12b-it | Best-of-breed: fast planner, proven executor, diverse reviewer |
| — | gemma-4-12b-it | qwen3.5-9b | gemma-4-12b-it | Tests gemma as planner (no tools needed) |

---

## LM Studio Models Available

```
microsoft/phi-4-mini-reasoning           (3.8B)
gemma-4-12b-it                            (12B)  — tools template broken
microsoft/phi-4-reasoning-plus            (14.7B) — tools ✅
qwen3.5-2b-kimi-and-opus-distillation-i1   (2B)
qwen3.6-27b-4bpw-16gb-vram               (27B)
huihui-qwen3.6-27b-abliterated            (27B)
qwen3.5-9b-deepseek-v4-flash              (9B)   — baseline
google/gemma-4-e2b                         (2B)
google/gemma-4-e4b                         (4B)
text-embedding-nomic-embed-text-v1.5       (embedding)
```
