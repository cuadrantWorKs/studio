'use server';

/**
 * @fileOverview A flow that uses GenAI to intelligently decide if the user should be prompted for job completion details, taking into account if the user has been prompted recently.
 *
 * - decidePromptForJobCompletion - A function that handles the decision process.
 * - DecidePromptForJobCompletionInput - The input type for the decidePromptForJobCompletion function.
 * - DecidePromptForJobCompletionOutput - The return type for the decidePromptForJobCompletion function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

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
  input: {schema: DecidePromptForJobCompletionInputSchema},
  output: {schema: DecidePromptForJobCompletionOutputSchema},
  prompt: `
  Here's the available information:
  - Distance moved: {{distanceMovedMeters}} meters
  - Last prompted time: {{lastJobPromptedTimestamp}}

  Consider these factors:
  - Prompt if the technician has moved a significant distance (more than 100 meters) since their last known location.
  - Avoid prompting too frequently. If the technician was prompted recently (e.g., within the last 30 minutes), it might be disruptive to prompt again.

  Reason your decision step by step, and return the answer in JSON format.

  Output:
  - shouldPrompt: true or false
  - reason: the explanation for the decision

  You must output a JSON object that conforms to this schema:
  {{outputSchemaDescription}}
  `,
});

const decidePromptForJobCompletionFlow = ai.defineFlow(
  {
    name: 'decidePromptForJobCompletionFlow',
    inputSchema: DecidePromptForJobCompletionInputSchema,
    outputSchema: DecidePromptForJobCompletionOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
