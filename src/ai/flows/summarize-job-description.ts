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
  prompt: `Sos un escritor técnico experto.
  
  Descripción del Trabajo:
  {{{jobDescription}}}

  Notas del Técnico:
  {{#if additionalNotes}}{{{additionalNotes}}}{{else}}(Ninguna){{/if}}
  
  Tarea: Creá un resumen profesional final del trabajo.
  Instrucciones:
  1. Combiná la Descripción del Trabajo y las Notas del Técnico.
  2. Las Notas del Técnico son la fuente de verdad más importante sobre lo que *realmente* pasó (ej: instalación exitosa, problemas específicos).
  3. Profesionalizá el lenguaje usando español argentino.
  4. CRÍTICO: NO inventés detalles que no estén en la descripción ni en las notas.
  
  Respondé SOLO con JSON válido:
  {"summary": "El texto del resumen profesional"}`,
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
