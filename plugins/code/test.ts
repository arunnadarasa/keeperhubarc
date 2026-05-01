export function testCode(
  _credentials: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  // No credentials; VM execution is validated at workflow run time in run-code step.
  return Promise.resolve({ success: true });
}
