'use server';

/**
 * @fileOverview A flow that uses GenAI to intelligently decide if the user should be prompted for job completion details, taking into account if the user has been prompted recently.
 *
 * - decidePromptForJobCompletion - A function that handles the decision process.
 * - DecidePromptForJobCompletionInput - The input type for the decidePromptForJobCompletion function.
 * - DecidePromptForJobCompletionOutput - The return type for the decidePromptForJobCompletion function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const DecidePromptForJobCompletionInputSchema = z.object({
  distanceMovedMeters: z
    .number()
    .describe('The distance the technician has moved in meters.'),
  lastJobPromptedTimestamp: z
    .number()
    .optional()
    .describe(
      'The timestamp of the last time the user was prompted for job details. Unix epoch time in milliseconds. If undefined, the user has not been prompted yet.'
    ),
});
export type DecidePromptForJobCompletionInput = z.infer<
  typeof DecidePromptForJobCompletionInputSchema
>;

const DecidePromptForJobCompletionOutputSchema = z.object({
  shouldPrompt: z
    .boolean()
    .describe(
      'Whether or not the user should be prompted for job completion details.'
    ),
  reason: z
    .string()
    .describe(
      'The reason for the decision, to be used for debugging and logging.'
    ),
});
export type DecidePromptForJobCompletionOutput = z.infer<
  typeof DecidePromptForJobCompletionOutputSchema
>;

export async function decidePromptForJobCompletion(
  input: DecidePromptForJobCompletionInput
): Promise<DecidePromptForJobCompletionOutput> {
  return decidePromptForJobCompletionFlow(input);
}

const prompt = ai.definePrompt({
  name: 'decidePromptForJobCompletionPrompt',
  input: { schema: DecidePromptForJobCompletionInputSchema },
  output: { schema: DecidePromptForJobCompletionOutputSchema },
  prompt: `You are an AI assistant helping determine if a technician should be prompted about job completion.

Input data:
- Distance moved: {{distanceMovedMeters}} meters
- Last prompted timestamp: {{lastJobPromptedTimestamp}}

Rules:
- Prompt if distance moved > 100 meters
- Don't prompt if prompted within last 30 minutes (1800000 ms)

Respond with ONLY valid JSON, no other text:
{"shouldPrompt": true or false, "reason": "brief explanation"}`,
});

const decidePromptForJobCompletionFlow = ai.defineFlow(
  {
    name: 'decidePromptForJobCompletionFlow',
    inputSchema: DecidePromptForJobCompletionInputSchema,
    outputSchema: DecidePromptForJobCompletionOutputSchema,
  },
  async input => {
    const { output } = await prompt(input);
    return output!;
  }
);
