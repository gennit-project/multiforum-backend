export const DEFAULT_FORBIDDEN_OPERATORS = [
  "AllNodesScan",
  "NodeByLabelScan",
  "CartesianProduct",
  "Eager",
] as const;

export type ProfilePlan = {
  operatorType: string;
  dbHits: number;
  rows: number;
  pageCacheHits?: number;
  pageCacheMisses?: number;
  children?: ProfilePlan[];
};

export type ProfileMetrics = {
  dbHits: number;
  maxIntermediateRows: number;
  resultCount: number;
  pageCacheHits: number;
  pageCacheMisses: number;
  operators: string[];
};

export type PerformanceBudget = {
  baseDbHits: number;
  dbHitsPerRequestedRow: number;
  baseIntermediateRows: number;
  intermediateRowsPerRequestedRow: number;
  requestedRows: number;
  allowedOperators?: string[];
};

export type BudgetEvaluation = {
  passed: boolean;
  maxDbHits: number;
  maxIntermediateRows: number;
  violations: string[];
};

export type ProfileResult = {
  name: string;
  description: string;
  requestedRows: number;
  cold: ProfileMetrics;
  warm: ProfileMetrics;
  evaluation: BudgetEvaluation;
};

const visitPlan = (
  plan: ProfilePlan,
  visitor: (current: ProfilePlan) => void
): void => {
  visitor(plan);
  for (const child of plan.children ?? []) {
    visitPlan(child, visitor);
  }
};

const normalizeOperator = (operatorType: string) =>
  operatorType.replace(/@[^@]+$/, "");

export const summarizeProfile = (
  plan: ProfilePlan,
  resultCount: number
): ProfileMetrics => {
  let dbHits = 0;
  let maxIntermediateRows = 0;
  let pageCacheHits = 0;
  let pageCacheMisses = 0;
  const operators = new Set<string>();

  visitPlan(plan, (operator) => {
    dbHits += operator.dbHits || 0;
    maxIntermediateRows = Math.max(maxIntermediateRows, operator.rows || 0);
    pageCacheHits += operator.pageCacheHits || 0;
    pageCacheMisses += operator.pageCacheMisses || 0;
    operators.add(normalizeOperator(operator.operatorType));
  });

  return {
    dbHits,
    maxIntermediateRows,
    resultCount,
    pageCacheHits,
    pageCacheMisses,
    operators: [...operators].sort(),
  };
};

export const evaluateProfile = (
  metrics: ProfileMetrics,
  budget: PerformanceBudget
): BudgetEvaluation => {
  const maxDbHits =
    budget.baseDbHits + budget.dbHitsPerRequestedRow * budget.requestedRows;
  const maxIntermediateRows =
    budget.baseIntermediateRows +
    budget.intermediateRowsPerRequestedRow * budget.requestedRows;
  const allowedOperators = new Set(budget.allowedOperators ?? []);
  const forbiddenOperators = metrics.operators.filter(
    (operator) =>
      DEFAULT_FORBIDDEN_OPERATORS.includes(
        operator as (typeof DEFAULT_FORBIDDEN_OPERATORS)[number]
      ) && !allowedOperators.has(operator)
  );
  const violations: string[] = [];

  if (metrics.dbHits > maxDbHits) {
    violations.push(`db hits ${metrics.dbHits} exceed budget ${maxDbHits}`);
  }
  if (metrics.maxIntermediateRows > maxIntermediateRows) {
    violations.push(
      `max intermediate rows ${metrics.maxIntermediateRows} exceed budget ${maxIntermediateRows}`
    );
  }
  if (forbiddenOperators.length > 0) {
    violations.push(
      `forbidden operators present: ${forbiddenOperators.join(", ")}`
    );
  }

  return {
    passed: violations.length === 0,
    maxDbHits,
    maxIntermediateRows,
    violations,
  };
};

export const renderPerformanceReport = (
  generatedAt: string,
  fixtureSummary: Record<string, number>,
  results: ProfileResult[]
): string => {
  const fixture = Object.entries(fixtureSummary)
    .map(([name, count]) => `${name}=${count}`)
    .join(", ");
  const rows = results.map((result) => {
    const status = result.evaluation.passed ? "PASS" : "FAIL";
    const violations = result.evaluation.violations.join("; ") || "—";
    return `| ${result.name} | ${result.requestedRows} | ${result.cold.dbHits} | ${result.warm.dbHits}/${result.evaluation.maxDbHits} | ${result.warm.maxIntermediateRows}/${result.evaluation.maxIntermediateRows} | ${status} | ${violations} |`;
  });

  return [
    "# Cypher performance budget report",
    "",
    `Generated: ${generatedAt}`,
    "",
    `Fixture: ${fixture}`,
    "",
    "The first profile is the cold pass over a freshly seeded database; the second is the warm pass used for budget enforcement.",
    "",
    "| Query | Requested rows | Cold db hits | Warm db hits / budget | Warm max rows / budget | Status | Violations |",
    "| --- | ---: | ---: | ---: | ---: | :---: | --- |",
    ...rows,
    "",
  ].join("\n");
};
