// Summarize the technician's job description using GenAI.

'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const SummarizeJobDescriptionInputSchema = z.object({
  jobDescription: z.string().describe('A brief description of the work done.'),
  additionalNotes: z.string().optional().describe('Any specific notes or details added by the technician to be included in the summary.'),
});
export type SummarizeJobDescriptionInput = z.infer<typeof SummarizeJobDescriptionInputSchema>;

const SummarizeJobDescriptionOutputSchema = z.object({
  summary: z.string().describe('A detailed summary of the work done.'),
});
export type SummarizeJobDescriptionOutput = z.infer<typeof SummarizeJobDescriptionOutputSchema>;

export async function summarizeJobDescription(
  input: SummarizeJobDescriptionInput
): Promise<SummarizeJobDescriptionOutput> {
  return summarizeJobDescriptionFlow(input);
}

const summarizeJobDescriptionPrompt = ai.definePrompt({
  name: 'summarizeJobDescriptionPrompt',
  input: { schema: SummarizeJobDescriptionInputSchema },
  output: { schema: SummarizeJobDescriptionOutputSchema },
  config: { temperature: 0.2 },
  prompt: `You are an expert technical writer.
  
  Job Description:
  {{{jobDescription}}}

  Technician's Notes:
  {{#if additionalNotes}}{{{additionalNotes}}}{{else}}(None){{/if}}
  
  Task: Create a professional final summary of the work.
  Instructions:
  1. Combine the Job Description and the Technician's Notes.
  2. The Technician's Notes are the most important source of truth for what *actually* happened (e.g., successful installation, specific issues).
  3. Professionalize the language.
  4. CRITICAL: Do NOT invent details not found in either the description or the notes.
  
  Respond with ONLY valid JSON:
  {"summary": "The professional summary text"}`,
});

const summarizeJobDescriptionFlow = ai.defineFlow(
  {
    name: 'summarizeJobDescriptionFlow',
    inputSchema: SummarizeJobDescriptionInputSchema,
    outputSchema: SummarizeJobDescriptionOutputSchema,
  },
  async input => {
    const { output } = await summarizeJobDescriptionPrompt(input);
    return output!;
  }
);
