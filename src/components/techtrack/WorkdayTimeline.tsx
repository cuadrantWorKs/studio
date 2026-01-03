'use client';

import { ScrollArea } from "@/components/ui/scroll-area";
import { TrackingEvent } from "@/lib/techtrack/types";
import { formatTime } from "@/lib/utils";
import {
    PlayCircle, PauseCircle, MapPin, Briefcase,
    CheckCircle, AlertTriangle, MessageSquare, Info
} from "lucide-react";

interface WorkdayTimelineProps {
    events: TrackingEvent[];
}

export default function WorkdayTimeline({ events }: WorkdayTimelineProps) {
    // Sort events by timestamp descending (newest first) or ascending? 
    // Timeline usually acts best descending (top is latest) or ascending (story).
    // Let's go ASCENDING (start of day at top).
    const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);

    const getIcon = (type: TrackingEvent['type']) => {
        switch (type) {
            case 'SESSION_START': return <PlayCircle className="h-4 w-4 text-green-500" />;
            case 'SESSION_END': return <StopCircle className="h-4 w-4 text-red-500" />;
            case 'SESSION_PAUSE': return <PauseCircle className="h-4 w-4 text-amber-500" />;
            case 'SESSION_RESUME': return <PlayCircle className="h-4 w-4 text-green-500" />;
            case 'JOB_START': return <Briefcase className="h-4 w-4 text-blue-500" />;
            case 'JOB_COMPLETED': return <CheckCircle className="h-4 w-4 text-purple-500" />;
            case 'NEW_JOB_PROMPT':
            case 'JOB_COMPLETION_PROMPT': return <MessageSquare className="h-4 w-4 text-indigo-500" />;
            case 'LOCATION_UPDATE': return <MapPin className="h-4 w-4 text-slate-400" />;
            case 'ERROR': return <AlertTriangle className="h-4 w-4 text-red-600" />;
            default: return <Info className="h-4 w-4 text-slate-500" />;
        }
    };

    const formatEventType = (type: string) => {
        return type.replace(/_/g, ' ');
    };

    return (
        <ScrollArea className="h-[60vh] md:h-[500px] w-full pr-4">
            <div className="relative border-l border-slate-200 ml-3 space-y-6 pb-4">
                {sortedEvents.map((event, idx) => (
                    <div key={event.id || idx} className="mb-4 ml-6 relative">
                        <span className="absolute -left-9 top-1 bg-white p-1 rounded-full border border-slate-200">
                            {getIcon(event.type)}
                        </span>
                        <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4">
                            <span className="text-xs font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <h4 className="text-sm font-semibold capitalize text-slate-800">
                                {formatEventType(event.type)}
                            </h4>
                        </div>
                        {event.details && (
                            <p className="text-sm text-slate-600 mt-1 bg-slate-50/50 p-2 rounded border border-slate-100/50">
                                {event.details}
                            </p>
                        )}
                        {event.location && (
                            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                {event.location.latitude.toFixed(5)}, {event.location.longitude.toFixed(5)}
                            </p>
                        )}
                    </div>
                ))}
            </div>
        </ScrollArea>
    );
}

function StopCircle({ className }: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><circle cx="12" cy="12" r="10" /><rect x="9" y="9" width="6" height="6" /></svg>
    )
}
