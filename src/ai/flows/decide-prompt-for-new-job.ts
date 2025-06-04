"use server";

/**
 * @fileOverview An AI agent that determines whether the user should be prompted for new job details.
 *
 * - decidePromptForNewJob - A function that determines if the user should be prompted for new job details.
 * - DecidePromptForNewJobInput - The input type for the decidePromptForNewJob function.
 * - DecidePromptForNewJobOutput - The return type for the decidePromptForNewJob function.
 */

import { ai } from "@/ai/genkit";
import { z } from "genkit";

const DecidePromptForNewJobInputSchema = z.object({
  hasBeenPromptedRecently: z
    .boolean()
    .describe("Whether the user has been prompted for job details recently."),
  timeStoppedInMinutes: z
    .number()
    .describe("The amount of time the user has been stopped in minutes."),
});
export type DecidePromptForNewJobInput = z.infer<
  typeof DecidePromptForNewJobInputSchema
>;

const DecidePromptForNewJobOutputSchema = z.object({
  shouldPrompt: z
    .boolean()
    .describe(
      "Whether the user should be prompted to enter information for a new job.",
    ),
  reason: z.string().describe("The reason for the decision."),
});
export type DecidePromptForNewJobOutput = z.infer<
  typeof DecidePromptForNewJobOutputSchema
>;

export async function decidePromptForNewJob(
  input: DecidePromptForNewJobInput,
): Promise<DecidePromptForNewJobOutput> {
  return decidePromptForNewJobFlow(input);
}

const prompt = ai.definePrompt({
  name: "decidePromptForNewJobPrompt",
  input: { schema: DecidePromptForNewJobInputSchema },
  output: { schema: DecidePromptForNewJobOutputSchema },
  prompt: `You are an AI assistant that helps determine whether a technician should be prompted to enter information about a new job.

  The technician has stopped moving for {{timeStoppedInMinutes}} minutes.
  It is known whether the technician has been prompted recently, specifically: {{#if hasBeenPromptedRecently}}they have been prompted recently{{else}}they have not been prompted recently{{/if}}.

  Based on this information, determine whether the technician should be prompted to enter information for a new job.
  Consider that prompting too often can be annoying, but not prompting enough can lead to incomplete data.
`,
});

const decidePromptForNewJobFlow = ai.defineFlow(
  {
    name: "decidePromptForNewJobFlow",
    inputSchema: DecidePromptForNewJobInputSchema,
    outputSchema: DecidePromptForNewJobOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    return output!;
  },
);
