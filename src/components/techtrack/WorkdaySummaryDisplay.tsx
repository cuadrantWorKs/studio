'use client';

import type { WorkdaySummaryContext, LocationPoint, PauseInterval } from '@/lib/techtrack/types';
import { formatTime } from '@/lib/utils';
import LocationInfo from './LocationInfo';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Clock, MapPin, Briefcase, PauseCircle, CheckCircle,
  Navigation, PlayCircle, StopCircle, Info, Calendar
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import dynamic from "next/dynamic";

// Dynamic import for Leaflet map to avoid SSR issues
const MapContainer = dynamic(
  () => import("react-leaflet").then((mod) => mod.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import("react-leaflet").then((mod) => mod.TileLayer),
  { ssr: false }
);
const Marker = dynamic(
  () => import("react-leaflet").then((mod) => mod.Marker),
  { ssr: false }
);
const Popup = dynamic(
  () => import("react-leaflet").then((mod) => mod.Popup),
  { ssr: false }
);

interface WorkdaySummaryDisplayProps {
  summary: WorkdaySummaryContext;
  showTitle?: boolean;
}

export default function WorkdaySummaryDisplay({ summary, showTitle = true }: WorkdaySummaryDisplayProps) {
  const getGoogleMapsLink = (location: LocationPoint) => `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`;

  return (
    <div className="max-h-[80vh] overflow-y-auto space-y-6 p-1 pr-2">
      {showTitle && (
        <div className="flex items-center gap-3 mb-2">
          <div className="bg-blue-100 p-2 rounded-lg">
            <Calendar className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Resumen de Jornada</h3>
            {summary.date && (
              <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">
                {new Date(summary.date.replace(/-/g, '/')).toLocaleDateString('es-ES', {
                  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
                })}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Overview Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard
          icon={<Clock className="h-4 w-4 text-green-500" />}
          label="Tiempo Activo"
          value={formatTime(summary.totalActiveTime)}
          bgColor="bg-green-50"
        />
        <StatCard
          icon={<PauseCircle className="h-4 w-4 text-amber-500" />}
          label="Tiempo Pausa"
          value={formatTime(summary.totalPausedTime)}
          bgColor="bg-amber-50"
        />
        <StatCard
          icon={<Navigation className="h-4 w-4 text-blue-500" />}
          label="Distancia"
          value={`${summary.totalDistanceKm.toFixed(2)} km`}
          bgColor="bg-blue-50"
        />
      </div>

      {/* Route Map */}
      <div className="h-48 w-full rounded-md overflow-hidden bg-slate-100 border relative z-0">
        {typeof window !== 'undefined' && summary.locationHistory && summary.locationHistory.length > 0 && (
          <MapContainer
            center={[summary.locationHistory[summary.locationHistory.length - 1].latitude, summary.locationHistory[summary.locationHistory.length - 1].longitude]}
            zoom={13}
            style={{ height: "100%", width: "100%" }}
            zoomControl={false}
            attributionControl={false}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {/* Start Marker */}
            {summary.startLocation && (
              <Marker position={[summary.startLocation.latitude, summary.startLocation.longitude]}>
                <Popup>Inicio de Jornada</Popup>
              </Marker>
            )}
            {/* Job Markers */}
            {summary.jobs.map(job => (
              job.startLocation && (
                <Marker key={job.id} position={[job.startLocation.latitude, job.startLocation.longitude]}>
                  <Popup>{job.description}</Popup>
                </Marker>
              )
            ))}
            {/* End Marker */}
            {summary.endLocation && (
              <Marker position={[summary.endLocation.latitude, summary.endLocation.longitude]}>
                <Popup>Fin de Jornada</Popup>
              </Marker>
            )}
          </MapContainer>
        )}
        {(!summary.locationHistory || summary.locationHistory.length === 0) && (
          <div className="flex items-center justify-center h-full text-slate-400 text-sm">
            <MapPin className="h-4 w-4 mr-2" />
            Sin datos de ruta
          </div>
        )}
      </div>

      {/* Start/End Locations */}
      <Card className="border-slate-200 shadow-sm overflow-hidden">
        <CardContent className="p-4 space-y-3 bg-slate-50/50">
          <div className="flex items-start gap-3">
            <PlayCircle className="h-4 w-4 text-green-500 mt-1 flex-shrink-0" />
            <div className="flex-1">
              {summary.startLocation && (
                <LocationInfo
                  location={summary.startLocation}
                  label="Inicio"
                  time={summary.startTime}
                  getGoogleMapsLink={getGoogleMapsLink}
                />
              )}
            </div>
          </div>
          <Separator className="bg-slate-200" />
          <div className="flex items-start gap-3">
            <StopCircle className="h-4 w-4 text-red-500 mt-1 flex-shrink-0" />
            <div className="flex-1">
              {summary.endLocation ? (
                <LocationInfo
                  location={summary.endLocation}
                  label="Fin"
                  time={summary.endTime}
                  getGoogleMapsLink={getGoogleMapsLink}
                />
              ) : (
                <span className="text-xs text-slate-400 italic">Jornada aún en curso</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Jobs Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-slate-600" />
            <h4 className="font-semibold text-slate-800">Trabajos</h4>
          </div>
          <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-none">
            {summary.jobs.length}
          </Badge>
        </div>

        {summary.jobs.length > 0 ? (
          <div className="space-y-3">
            {summary.jobs.map((job, idx) => (
              <Card key={job.id} className="border-slate-200 shadow-sm hover:border-blue-200 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3 pb-3 border-b border-slate-100 mb-3">
                    <div className="bg-blue-100 text-blue-700 text-[10px] font-bold h-5 w-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5">
                      {idx + 1}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <h5 className="text-sm font-bold text-slate-900 leading-tight">{job.description}</h5>
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 uppercase ${job.status === 'completed' ? 'text-green-600 border-green-200 bg-green-50' : 'text-blue-600 border-blue-200 bg-blue-50'
                          }`}>
                          {job.status === 'completed' ? 'Completado' : 'Activo'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 text-[10px] text-slate-500">
                        <Clock className="h-3 w-3" />
                        <span>{new Date(job.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {job.endTime && (
                          <>
                            <span>→</span>
                            <span>{new Date(job.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            <span className="text-slate-300 ml-1">({formatTime(job.endTime - job.startTime)})</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <LocationInfo location={job.startLocation} showCoordinates={false} />
                    {job.endLocation && <LocationInfo location={job.endLocation} showCoordinates={false} />}
                    {(job.summary || job.aiSummary) && (
                      <div className="bg-slate-50 p-2 rounded text-xs text-slate-600 border border-slate-100 mt-2">
                        <span className="font-semibold text-slate-700 block mb-1">Resumen:</span>
                        {job.aiSummary || job.summary}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 bg-slate-50 rounded-lg border border-dashed border-slate-200">
            <Info className="h-5 w-5 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-400">No se registraron trabajos.</p>
          </div>
        )}
      </div>

      {/* Pauses Section */}
      {summary.pauseIntervals.filter(p => p.endTime).length > 0 && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-2 px-1">
            <PauseCircle className="h-4 w-4 text-slate-600" />
            <h4 className="font-semibold text-slate-800">Pausas</h4>
          </div>
          <div className="space-y-2">
            {summary.pauseIntervals
              .filter((p: PauseInterval) => p.endTime !== undefined && p.startTime !== undefined)
              .map((pause, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                  <div className="flex items-center gap-3">
                    <div className="text-amber-500">
                      <PauseCircle className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-700">
                        {new Date(pause.startTime!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} a {new Date(pause.endTime!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      <p className="text-[10px] text-slate-500">Pausa registrada</p>
                    </div>
                  </div>
                  <div className="font-mono text-amber-700 bg-amber-100/50 px-2 py-0.5 rounded">
                    {formatTime(pause.endTime! - pause.startTime!)}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, bgColor }: { icon: React.ReactNode, label: string, value: string, bgColor: string }) {
  return (
    <div className={`${bgColor} p-3 rounded-xl border border-white/50 shadow-sm transition-all hover:scale-[1.02]`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500">{label}</span>
      </div>
      <div className="text-sm font-bold text-slate-800">{value}</div>
    </div>
  );
}

