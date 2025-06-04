// Summarize the technician's job description using GenAI.

"use server";

import { ai } from "@/ai/genkit";
import { z } from "genkit";

const SummarizeJobDescriptionInputSchema = z.object({
  jobDescription: z.string().describe("A brief description of the work done."),
  userSummary: z.string().describe("The summary provided by the user."), // Added userSummary
});
export type SummarizeJobDescriptionInput = z.infer<
  typeof SummarizeJobDescriptionInputSchema
>;

const SummarizeJobDescriptionOutputSchema = z.object({
  summary: z.string().describe("A detailed summary of the work done."),
});
export type SummarizeJobDescriptionOutput = z.infer<
  typeof SummarizeJobDescriptionOutputSchema
>;

export async function summarizeJobDescription(
  input: SummarizeJobDescriptionInput,
): Promise<SummarizeJobDescriptionOutput> {
  return summarizeJobDescriptionFlow(input);
}

const summarizeJobDescriptionPrompt = ai.definePrompt({
  name: "summarizeJobDescriptionPrompt",
  input: { schema: SummarizeJobDescriptionInputSchema },
  output: { schema: SummarizeJobDescriptionOutputSchema },
  prompt: `You are an expert at writing summaries of technical work.
  Based on the following description and user provided summary, write a detailed summary of the work done:
  Job Description: {{{jobDescription}}}
  User Summary: {{{userSummary}}}`, // Modified prompt to include userSummary
});

const summarizeJobDescriptionFlow = ai.defineFlow(
  {
    name: "summarizeJobDescriptionFlow",
    inputSchema: SummarizeJobDescriptionInputSchema,
    outputSchema: SummarizeJobDescriptionOutputSchema,
  },
  async (input) => {
    const { output } = await summarizeJobDescriptionPrompt(input);
    return output!;
  },
);
