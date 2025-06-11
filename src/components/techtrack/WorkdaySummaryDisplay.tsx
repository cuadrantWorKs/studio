'use client';

import type { WorkdaySummaryContext, LocationPoint } from '@/lib/techtrack/types';
import { formatTime } from '@/lib/utils';
import LocationInfo from './LocationInfo';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface WorkdaySummaryDisplayProps {
  summary: WorkdaySummaryContext;
  showTitle?: boolean;
}

export default function WorkdaySummaryDisplay({ summary, showTitle = true }: WorkdaySummaryDisplayProps) {
  const getGoogleMapsLink = (location: LocationPoint) => `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`;

  return (
    <div className="max-h-[70vh] overflow-y-auto space-y-4 p-1 pr-2">
      {showTitle && (
        <CardHeader className="p-0 mb-4">
          <CardTitle>Workday Summary</CardTitle>
          {summary.date && <CardDescription>Summary for {new Date(summary.date).toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</CardDescription>}
        </CardHeader>
      )}
      <div className="space-y-1">
        <LocationInfo location={summary.startLocation} label="Workday Started:" time={summary.startTime ?? null} getGoogleMapsLink={getGoogleMapsLink} />
        <LocationInfo location={summary.endLocation} label="Workday Ended:" time={summary.endTime ?? null} getGoogleMapsLink={getGoogleMapsLink} />
      </div>
      
      <p><strong>Total Active Time:</strong> {formatTime(summary.totalActiveTime ?? null)}</p>
      <p><strong>Total Paused Time:</strong> {formatTime(summary.totalPausedTime)}</p>
      <p><strong>Total Distance:</strong> {summary.totalDistanceKm.toFixed(2)} km</p>
      
      <h4 className="font-semibold mt-2">Jobs ({summary.jobs?.length ?? 0}):</h4>
      {summary.jobs?.length > 0 ? (
        <ul className="list-disc pl-5 space-y-2 text-sm">
          {summary.jobs?.map(job => (
            <li key={job.id}>
              <div><strong>{job.description}</strong> ({job.status})</div>
              <LocationInfo location={job.startLocation} label="Started at" time={job.startTime} getGoogleMapsLink={getGoogleMapsLink}/>
              {job.endTime && job.endLocation && (
                 <LocationInfo location={job.endLocation} label="Ended at" time={job.endTime} getGoogleMapsLink={getGoogleMapsLink}/>
              )}
              {job.summary && <p className="text-xs text-muted-foreground mt-1">Summary: {job.summary}</p>}
              {job.aiSummary && <p className="text-xs text-muted-foreground">AI Summary: {job.aiSummary}</p>}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">No jobs recorded.</p>}

      <h4 className="font-semibold mt-2">Pauses ({summary.pauseIntervals.filter(p => p.endTime).length}):</h4>
       {summary.pauseIntervals.filter(p => p.endTime).length > 0 ? (
        <ul className="list-disc pl-5 space-y-2 text-sm">
          {summary.pauseIntervals.filter(p => p.endTime && p.startTime).map((pause,idx) => (
            <li key={idx}>
              Paused from {new Date(pause.startTime!).toLocaleTimeString()} for {formatTime(pause.endTime! - pause.startTime!)}
              <LocationInfo location={pause.startLocation} label="Paused at" getGoogleMapsLink={getGoogleMapsLink} />
              {pause.endLocation && (
                <LocationInfo location={pause.endLocation} label="Resumed at" getGoogleMapsLink={getGoogleMapsLink}/>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">No pauses recorded.</p>}
    </div>
  );
}
