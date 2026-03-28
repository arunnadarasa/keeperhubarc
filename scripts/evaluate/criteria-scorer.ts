import { generateText, Output } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

export const CriterionGradeSchema = z.object({
  passed: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z.string(),
  evidence: z.string(),
});

export type CriterionGrade = z.infer<typeof CriterionGradeSchema>;

export async function scoreCriterion(
  criterionId: string,
  criterionDescription: string,
  screenshotPath: string | undefined,
  tokenAuditOutput: string,
): Promise<CriterionGrade> {
  const anthropic = createAnthropic();

  const screenshotContext =
    screenshotPath !== undefined
      ? `\nScreenshot captured at: ${screenshotPath}`
      : "";

  const prompt = `Criterion ID: ${criterionId}
Criterion Description: ${criterionDescription}${screenshotContext}

Token Audit Output:
${tokenAuditOutput}

Based on this evidence, determine whether the criterion passes or fails.`;

  const result = await generateText({
    model: anthropic("claude-sonnet-4-5"),
    system:
      "You are a design token compliance evaluator for KeeperHub UI. Your job is to determine whether a UI criterion passes or fails based on evidence. You must be objective. A criterion passes only if you have concrete evidence it is satisfied. When in doubt, return passed: false with reason.",
    prompt,
    experimental_output: Output.object({ schema: CriterionGradeSchema }),
  });

  return result.experimental_output;
}
