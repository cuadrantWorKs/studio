'use client';

import type { WorkdaySummaryContext, LocationPoint, PauseInterval } from '@/lib/techtrack/types';
import { formatTime } from '@/lib/utils';
import LocationInfo from './LocationInfo';
import { CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

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
          <CardTitle>Resumen de Jornada</CardTitle>
          {summary.date && <CardDescription>Resumen del {new Date(summary.date.replace(/-/g, '/')).toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</CardDescription>}
        </CardHeader>
      )}
      <div className="space-y-1 text-sm">
        {summary.startLocation && <LocationInfo location={summary.startLocation} label="Jornada Iniciada:" time={summary.startTime} getGoogleMapsLink={getGoogleMapsLink} />}
        {summary.endLocation && <LocationInfo location={summary.endLocation} label="Jornada Finalizada:" time={summary.endTime} getGoogleMapsLink={getGoogleMapsLink} />}
      </div>

      <p><strong>Tiempo Activo Total:</strong> {formatTime(summary.totalActiveTime)}</p>
      <p><strong>Tiempo de Pausa Total:</strong> {formatTime(summary.totalPausedTime)}</p>
      <p><strong>Distancia Total:</strong> {summary.totalDistanceKm.toFixed(2)} km</p>

      <h4 className="font-semibold mt-2">Trabajos ({summary.jobs.length}):</h4>
      {summary.jobs.length > 0 ? (
        <ul className="list-disc pl-5 space-y-2 text-sm">
          {summary.jobs.map(job => (
            <li key={job.id}>
              <div><strong>{job.description}</strong> ({job.status})</div>
              <LocationInfo location={job.startLocation} label="Iniciado a las" time={job.startTime} getGoogleMapsLink={getGoogleMapsLink} />
              {(job.endTime !== undefined && job.endLocation !== undefined && job.endLocation !== null) && (
                <LocationInfo location={job.endLocation} label="Finalizado a las" time={job.endTime} getGoogleMapsLink={getGoogleMapsLink} />
              )}
              {job.summary && <p className="text-xs text-muted-foreground mt-1">Resumen: {job.summary}</p>}
              {job.aiSummary && <p className="text-xs text-muted-foreground">Resumen IA: {job.aiSummary}</p>}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">No se registraron trabajos.</p>}

      <h4 className="font-semibold mt-2">Pausas ({summary.pauseIntervals.filter(p => p.endTime).length}):</h4>
      {summary.pauseIntervals.filter((p: PauseInterval) => p.endTime !== undefined && p.startTime !== undefined).length > 0 ? (
        <ul className="list-disc pl-5 space-y-2 text-sm">
          {summary.pauseIntervals.filter((p: PauseInterval) => p.endTime !== undefined && p.startTime !== undefined).map((pause, idx) => (
            <li key={idx}>
              Pausado desde las {new Date(pause.startTime!).toLocaleTimeString()} por {formatTime(pause.endTime! - pause.startTime!)}
              {pause.startLocation !== undefined && pause.startLocation !== null && <LocationInfo location={pause.startLocation} label="Pausado en" getGoogleMapsLink={getGoogleMapsLink} />}
              {pause.endLocation && (
                <LocationInfo location={pause.endLocation} label="Reanudado en" getGoogleMapsLink={getGoogleMapsLink} />
              )}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">No se registraron pausas.</p>}
    </div>
  );
}
