import { metrics, trace, type Span } from "@opentelemetry/api";

/**
 * OpenTelemetry instruments and LLM cost accounting.
 *
 * The SDK itself is started in `instrumentation.ts`; this module only defines
 * the instruments and the helpers that record to them, so it stays importable
 * from anywhere without triggering SDK initialisation.
 */

export const SERVICE_NAME = "recipe-generator";

const tracer = trace.getTracer(SERVICE_NAME);
const meter = metrics.getMeter(SERVICE_NAME);

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

interface ModelPricing {
  /** USD per million input tokens. */
  inputPerMTok: number;
  /** USD per million output tokens. */
  outputPerMTok: number;
}

/**
 * Published list prices, in USD per million tokens.
 *
 * Hardcoding prices is a deliberate trade: it makes cost visible in the
 * dashboard without an extra API dependency, at the cost of going stale if
 * Anthropic changes them. The date is recorded so a reader knows how much to
 * trust the number.
 */
export const PRICING_AS_OF = "2026-06-24";

const PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-4-6": { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  "claude-haiku-4-5-20251001": { inputPerMTok: 1.0, outputPerMTok: 5.0 },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

/**
 * USD cost of one request.
 *
 * Cache writes bill at 1.25x the input rate and cache reads at 0.10x, so a
 * naive `input + output` sum would misreport any cached call.
 */
export function computeCostUsd(model: string, usage: TokenUsage): number {
  const pricing = PRICING[model];
  if (!pricing) return 0;

  const perInputToken = pricing.inputPerMTok / 1_000_000;
  const perOutputToken = pricing.outputPerMTok / 1_000_000;

  return (
    usage.inputTokens * perInputToken +
    usage.outputTokens * perOutputToken +
    (usage.cacheCreationInputTokens ?? 0) * perInputToken * 1.25 +
    (usage.cacheReadInputTokens ?? 0) * perInputToken * 0.1
  );
}

export const isPricingKnown = (model: string): boolean => model in PRICING;

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

const generationCounter = meter.createCounter("llm.generations", {
  description: "LLM generation attempts, by model and outcome",
});

const tokenCounter = meter.createCounter("llm.tokens", {
  description: "Tokens consumed, by model and direction",
});

const costCounter = meter.createCounter("llm.cost.usd", {
  description: "Estimated LLM spend in USD",
});

// No `unit` set deliberately: the Prometheus exporter appends the unit to the
// metric name, and a stable name is worth more here than a self-describing one
// — the dashboards and the alert rule reference it directly.
const latencyHistogram = meter.createHistogram("llm.latency", {
  description: "LLM request latency, in milliseconds",
});

const fallbackCounter = meter.createCounter("planner.fallbacks", {
  description: "Times the agentic planner fell back to deterministic planning",
});

const verifierCounter = meter.createCounter("planner.verifier.verdicts", {
  description: "Planner verifier verdicts, by outcome",
});

const schedulerCounter = meter.createCounter("scheduler.runs", {
  description: "Scheduler runs, by status",
});

// ---------------------------------------------------------------------------
// Recording helpers
// ---------------------------------------------------------------------------

export interface GenerationOutcome {
  model: string;
  /** `recipe`, `planner`, or `judge`. */
  operation: string;
  usage: TokenUsage;
  latencyMs: number;
  retries: number;
  status: "success" | "invalid" | "error";
}

/**
 * Records one generation to both the active span and the metric instruments.
 * Span attributes give per-request detail when debugging; the counters give
 * the aggregate view the Grafana dashboards are built on.
 */
export function recordGeneration(outcome: GenerationOutcome): number {
  const { model, operation, usage, latencyMs, retries, status } = outcome;
  const costUsd = computeCostUsd(model, usage);
  const attributes = { model, operation, status };

  generationCounter.add(1, attributes);
  tokenCounter.add(usage.inputTokens, { model, operation, direction: "input" });
  tokenCounter.add(usage.outputTokens, { model, operation, direction: "output" });
  costCounter.add(costUsd, { model, operation });
  latencyHistogram.record(latencyMs, attributes);

  trace.getActiveSpan()?.setAttributes({
    "llm.model": model,
    "llm.operation": operation,
    "llm.usage.input_tokens": usage.inputTokens,
    "llm.usage.output_tokens": usage.outputTokens,
    "llm.usage.cache_read_input_tokens": usage.cacheReadInputTokens ?? 0,
    "llm.cost.usd": costUsd,
    "llm.latency_ms": latencyMs,
    "llm.retries": retries,
    "llm.status": status,
  });

  return costUsd;
}

export function recordPlannerFallback(reason: string): void {
  fallbackCounter.add(1, { reason });
  trace.getActiveSpan()?.setAttributes({ "planner.fell_back": true, "planner.fallback_reason": reason });
}

export function recordVerifierVerdict(ok: boolean, attempt: number): void {
  verifierCounter.add(1, { verdict: ok ? "accepted" : "rejected" });
  trace.getActiveSpan()?.addEvent("planner.verifier", {
    attempt,
    verdict: ok ? "accepted" : "rejected",
  });
}

export function recordSchedulerRun(status: string, fellBack: boolean): void {
  schedulerCounter.add(1, { status, fell_back: String(fellBack) });
}

/** Runs `fn` inside a span, marking the span failed if it throws. */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: 2, message: (error as Error).message });
      throw error;
    } finally {
      span.end();
    }
  });
}
