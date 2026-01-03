'use client';

import { ScrollArea } from "@/components/ui/scroll-area";
import { Workday } from "@/lib/techtrack/types";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"; // Assuming we have accordion or I'll just use pre tags

export default function RawDataInspector({ workday }: { workday: Workday }) {
    // Helper to safely stringify
    const formatJSON = (data: any) => JSON.stringify(data, null, 2);

    return (
        <div className="space-y-4">
            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                <h4 className="font-semibold mb-2 text-sm">Full Record ID: {workday.id}</h4>
                <ScrollArea className="h-[60vh] md:h-[500px]">
                    <pre className="text-xs font-mono whitespace-pre-wrap text-slate-700">
                        {formatJSON(workday)}
                    </pre>
                </ScrollArea>
            </div>
        </div>
    );
}
