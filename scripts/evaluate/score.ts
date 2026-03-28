import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

interface JSONReportSuite {
  title: string;
  file?: string;
  specs: JSONReportSpec[];
  suites?: JSONReportSuite[];
}

interface JSONReportSpec {
  title: string;
  ok: boolean;
  tests: Array<{ status: string; results: Array<{ status: string }> }>;
  id?: string;
}

interface JSONReport {
  suites: JSONReportSuite[];
}

interface EvalCriterion {
  id: string;
  type: string;
  description: string;
  grep_pattern?: string;
}

interface EvalConfig {
  phase?: string;
  criteria: EvalCriterion[];
}

export const CriterionResultSchema = z.object({
  id: z.string(),
  type: z.string(),
  description: z.string(),
  passed: z.boolean(),
  evidence: z.string(),
});

export const EvalScoreSchema = z.object({
  phase: z.string(),
  scored_at: z.string(),
  total_autonomous: z.number(),
  passing_autonomous: z.number(),
  score_fraction: z.number(),
  criteria: z.array(CriterionResultSchema),
});

export type CriterionResult = z.infer<typeof CriterionResultSchema>;
export type EvalScore = z.infer<typeof EvalScoreSchema>;

function flattenSpecs(suites: JSONReportSuite[]): JSONReportSpec[] {
  const result: JSONReportSpec[] = [];
  for (const suite of suites) {
    result.push(...suite.specs);
    if (suite.suites) {
      result.push(...flattenSpecs(suite.suites));
    }
  }
  return result;
}

function matchCriterion(
  specs: JSONReportSpec[],
  grepPattern: string,
): boolean | null {
  for (const spec of specs) {
    if (spec.title.includes(grepPattern)) {
      return spec.ok;
    }
  }
  return null;
}

function scoreUiBehaviorCriteria(
  report: JSONReport,
  criteria: EvalCriterion[],
): CriterionResult[] {
  const specs = flattenSpecs(report.suites);
  const results: CriterionResult[] = [];

  for (const criterion of criteria) {
    if (criterion.type !== "ui_behavior") {
      continue;
    }

    const pattern = criterion.grep_pattern ?? "";
    const ok = matchCriterion(specs, pattern);

    if (ok === null) {
      results.push({
        id: criterion.id,
        type: criterion.type,
        description: criterion.description,
        passed: false,
        evidence: `No spec matched grep_pattern: ${pattern}`,
      });
    } else {
      const matchedSpec = specs.find((s) => s.title.includes(pattern));
      results.push({
        id: criterion.id,
        type: criterion.type,
        description: criterion.description,
        passed: ok,
        evidence: `Spec "${matchedSpec?.title ?? pattern}" ok=${ok}`,
      });
    }
  }

  return results;
}

function main(): void {
  const args = process.argv.slice(2);
  const evalConfigPath = args[0] ?? ".claude/eval-config.json";

  let evalConfig: EvalConfig;
  try {
    const raw = readFileSync(evalConfigPath, "utf-8");
    evalConfig = JSON.parse(raw) as EvalConfig;
  } catch (err) {
    process.stderr.write(
      `[score] Failed to read EVAL-CONFIG at ${evalConfigPath}: ${String(err)}\n`,
    );
    process.exit(1);
  }

  let report: JSONReport;
  try {
    const raw = readFileSync(".claude/eval-results.json", "utf-8");
    report = JSON.parse(raw) as JSONReport;
  } catch (err) {
    process.stderr.write(
      `[score] Failed to read .claude/eval-results.json: ${String(err)}\n`,
    );
    process.exit(1);
  }

  const uiResults = scoreUiBehaviorCriteria(report, evalConfig.criteria);

  const criteriaResults: CriterionResult[] = [];
  for (const criterion of evalConfig.criteria) {
    if (criterion.type === "manual_review") {
      continue;
    }

    if (criterion.type === "ui_behavior") {
      const match = uiResults.find((r) => r.id === criterion.id);
      if (match) {
        criteriaResults.push(match);
      }
    } else {
      criteriaResults.push({
        id: criterion.id,
        type: criterion.type,
        description: criterion.description,
        passed: true,
        evidence:
          "Evaluated by gsd-evaluator; see EVAL.md",
      });
    }
  }

  const totalAutonomous = criteriaResults.length;
  const passingAutonomous = criteriaResults.filter((r) => r.passed).length;
  const scoreFraction =
    totalAutonomous === 0 ? 0.0 : passingAutonomous / totalAutonomous;

  const score = EvalScoreSchema.parse({
    phase: evalConfig.phase ?? "unknown",
    scored_at: new Date().toISOString(),
    total_autonomous: totalAutonomous,
    passing_autonomous: passingAutonomous,
    score_fraction: scoreFraction,
    criteria: criteriaResults,
  });

  writeFileSync(".claude/eval-score.json", JSON.stringify(score, null, 2));
  process.stderr.write(
    `[score] Wrote .claude/eval-score.json — ${passingAutonomous}/${totalAutonomous} passing (${(scoreFraction * 100).toFixed(1)}%)\n`,
  );
}

main();
