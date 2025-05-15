// Summarize the technician's job description using GenAI.

'use server';

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SummarizeJobDescriptionInputSchema = z.object({
  jobDescription: z.string().describe('A brief description of the work done.'),
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
  input: {schema: SummarizeJobDescriptionInputSchema},
  output: {schema: SummarizeJobDescriptionOutputSchema},
  prompt: `You are an expert at writing summaries of technical work.
  Based on the following description, write a detailed summary of the work done:
  {{{jobDescription}}}`,
});

const summarizeJobDescriptionFlow = ai.defineFlow(
  {
    name: 'summarizeJobDescriptionFlow',
    inputSchema: SummarizeJobDescriptionInputSchema,
    outputSchema: SummarizeJobDescriptionOutputSchema,
  },
  async input => {
    const {output} = await summarizeJobDescriptionPrompt(input);
    return output!;
  }
);
