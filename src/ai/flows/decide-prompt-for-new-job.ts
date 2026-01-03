'use server';

/**
 * @fileOverview An AI agent that determines whether the user should be prompted for new job details.
 *
 * - decidePromptForNewJob - A function that determines if the user should be prompted for new job details.
 * - DecidePromptForNewJobInput - The input type for the decidePromptForNewJob function.
 * - DecidePromptForNewJobOutput - The return type for the decidePromptForNewJob function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const DecidePromptForNewJobInputSchema = z.object({
  hasBeenPromptedRecently: z
    .boolean()
    .describe('Whether the user has been prompted for job details recently.'),
  timeStoppedInMinutes: z
    .number()
    .describe('The amount of time the user has been stopped in minutes.'),
});
export type DecidePromptForNewJobInput = z.infer<
  typeof DecidePromptForNewJobInputSchema
>;

const DecidePromptForNewJobOutputSchema = z.object({
  shouldPrompt: z
    .boolean()
    .describe(
      'Whether the user should be prompted to enter information for a new job.'
    ),
  reason: z.string().describe('The reason for the decision.'),
});
export type DecidePromptForNewJobOutput = z.infer<
  typeof DecidePromptForNewJobOutputSchema
>;

export async function decidePromptForNewJob(
  input: DecidePromptForNewJobInput
): Promise<DecidePromptForNewJobOutput> {
  return decidePromptForNewJobFlow(input);
}

const prompt = ai.definePrompt({
  name: 'decidePromptForNewJobPrompt',
  input: { schema: DecidePromptForNewJobInputSchema },
  output: { schema: DecidePromptForNewJobOutputSchema },
  prompt: `You are an AI assistant helping determine if a technician should be prompted to start a new job.

Input data:
- Time stopped: {{timeStoppedInMinutes}} minutes
- Was prompted recently: {{hasBeenPromptedRecently}}

Rules:
- Prompt if stopped for 15+ minutes and not prompted recently
- Don't prompt too often to avoid being annoying

Respond with ONLY valid JSON, no other text:
{"shouldPrompt": true or false, "reason": "brief explanation"}`,
});

const decidePromptForNewJobFlow = ai.defineFlow(
  {
    name: 'decidePromptForNewJobFlow',
    inputSchema: DecidePromptForNewJobInputSchema,
    outputSchema: DecidePromptForNewJobOutputSchema,
  },
  async input => {
    const { output } = await prompt(input);
    return output!;
  }
);
