"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  MapPin, Play, Pause, StopCircle, Briefcase, Clock, CheckCircle,
  AlertTriangle, Loader2, User, MessageSquareText, MapPinned, BrainCircuit
} from 'lucide-react';

import { calculateWorkdaySummary } from '@/lib/techtrack/summary';
import { calculateRobustDistance, fetchDrivingDistance } from '@/lib/techtrack/geometry';
import WorkdaySummaryDisplay from './WorkdaySummaryDisplay';
import { Label } from '@/components/ui/label';
import { formatTime } from '@/lib/utils';
import LocationInfo from './LocationInfo';
import type {
  LocationPoint, Job, Workday, PauseInterval, WorkdaySummaryContext, TrackingEvent
} from '@/lib/techtrack/types';
import { summarizeJobDescription } from '@/ai/flows/summarize-job-description';
import { Wand2 } from 'lucide-react';

import { useGeolocation } from '@/hooks/useGeolocation';
import { useWorkday } from '@/hooks/useWorkday';
import { useAiPrompts } from '@/hooks/useAiPrompts';
import { SupabaseService } from '@/lib/techtrack/supabase-service';

const LOCATION_INTERVAL_MS = 5 * 60 * 1000;

interface TechTrackAppProps {
  technicianName: string;
}

export default function TechTrackApp({ technicianName }: TechTrackAppProps) {
  const { currentLocation, geolocationError, sanitizeLocationPoint } = useGeolocation();
  const { workday, setWorkday, elapsedTime, recordEvent, currentJob, getLocalStorageKey } = useWorkday(technicianName, currentLocation);

  const [isJobModalOpen, setIsJobModalOpen] = useState(false);
  const [jobModalMode, setJobModalMode] = useState<'new' | 'summary'>('new');
  const [currentJobFormData, setCurrentJobFormData] = useState({ description: '', summary: '' });
  const [pendingJobStartTime, setPendingJobStartTime] = useState<number | null>(null);
  const [activityType, setActivityType] = useState<'job' | 'break' | 'supplies'>('job');
  const [personalBreakReason, setPersonalBreakReason] = useState('');
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);
  const [endOfDaySummary, setEndOfDaySummary] = useState<WorkdaySummaryContext | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isSavingToCloud, setIsSavingToCloud] = useState(false);
  const [pendingEndDayAction, setPendingEndDayAction] = useState(false);
  const [jobToSummarizeId, setJobToSummarizeId] = useState<string | null>(null);

  const { toast } = useToast();

  const openJobModal = (mode: 'new' | 'summary', data?: { description?: string; summary?: string }, startTime?: number) => {
    setJobModalMode(mode);
    if (data) setCurrentJobFormData({ description: data.description || '', summary: data.summary || '' });
    if (startTime) setPendingJobStartTime(startTime);
    setActivityType('job');
    setPersonalBreakReason('');
    setIsJobModalOpen(true);
  };

  const { aiLoading } = useAiPrompts({
    workday,
    currentLocation,
    currentJob,
    isJobModalOpen,
    setWorkday,
    recordEvent,
    openJobModal
  });

  const getCurrentFormattedDate = () => new Date().toISOString().split('T')[0];

  // Periodic location updates
  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    if (workday?.status === 'tracking' && currentLocation) {
      intervalId = setInterval(() => {
        const safeCurrentLocation = sanitizeLocationPoint(currentLocation);
        if (safeCurrentLocation) {
          setWorkday(prev => prev ? ({ ...prev, locationHistory: [...prev.locationHistory, safeCurrentLocation] }) : null);
          recordEvent('LOCATION_UPDATE', safeCurrentLocation, undefined, "Actualización periódica de 5 min");
        }
      }, LOCATION_INTERVAL_MS);
    }
    return () => clearInterval(intervalId);
  }, [workday?.status, currentLocation, recordEvent, sanitizeLocationPoint, setWorkday]);

  const handleStartTracking = () => {
    const safeCurrentLocation = sanitizeLocationPoint(currentLocation);
    if (!safeCurrentLocation) {
      toast({ title: "Ubicación Requerida", description: "No se puede iniciar el seguimiento sin ubicación.", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    setEndOfDaySummary(null);
    const startTime = Date.now();
    const newWorkday: Workday = {
      id: crypto.randomUUID(),
      userId: technicianName,
      date: getCurrentFormattedDate(),
      startTime: startTime,
      startLocation: safeCurrentLocation,
      status: 'tracking',
      locationHistory: [safeCurrentLocation],
      jobs: [],
      events: [{ id: crypto.randomUUID(), type: 'SESSION_START', timestamp: startTime, location: safeCurrentLocation || undefined, details: `Sesión iniciada por ${technicianName}` }],
      pauseIntervals: [],
    };
    setWorkday(newWorkday);
    toast({ title: "Seguimiento Iniciado", description: "Tu jornada laboral ha comenzado. Modo Viaje activo." });
    // Auto-prompt removed to allow travel time.
    setIsLoading(false);
  };

  const handlePauseTracking = () => {
    if (!workday) return;
    setIsLoading(true);
    const now = Date.now();
    const newPauseInterval: PauseInterval = {
      id: crypto.randomUUID(),
      startTime: now,
      startLocation: sanitizeLocationPoint(currentLocation) || undefined
    } as PauseInterval;
    setWorkday(prev => prev ? ({
      ...prev,
      status: 'paused',
      pauseIntervals: [...prev.pauseIntervals, newPauseInterval],
    }) : null);
    recordEvent('SESSION_PAUSE', sanitizeLocationPoint(currentLocation));
    toast({ title: "Seguimiento Pausado" });
    setIsLoading(false);
  };

  const handleResumeTracking = () => {
    if (!workday) return;
    setIsLoading(true);
    const now = Date.now();
    setWorkday(prev => {
      if (!prev) return null;
      const updatedPauses = [...prev.pauseIntervals];
      if (updatedPauses.length > 0) {
        const currentPause = updatedPauses[updatedPauses.length - 1];
        if (!currentPause.endTime && currentPause.startTime) {
          currentPause.endTime = now;
          currentPause.endLocation = sanitizeLocationPoint(currentLocation) ?? undefined;
        }
      }
      return { ...prev, status: 'tracking', pauseIntervals: updatedPauses };
    });
    recordEvent('SESSION_RESUME', sanitizeLocationPoint(currentLocation));
    toast({ title: "Seguimiento Reanudado" });
    setIsLoading(false);
  };

  const initiateEndDayProcess = async (workdayDataToEnd: Workday | null) => {
    if (!workdayDataToEnd) {
      console.error("initiateEndDayProcess called with null workdayDataToEnd");
      toast({ title: "Error Interno", description: "No se pueden finalizar los datos del día.", variant: "destructive" });
      setIsLoading(false);
      return;
    }
    const actionTime = Date.now();
    setIsLoading(true);
    setIsSavingToCloud(true);

    setTimeout(async () => {
      await finalizeWorkdayAndSave(workdayDataToEnd, actionTime);
    }, 0);
  };

  const finalizeWorkdayAndSave = async (workdayAtStartOfEnd: Workday, finalizationTimestamp: number) => {
    setIsSavingToCloud(true);
    let finalizedWorkdayForSave: Workday | null = null;

    try {
      finalizedWorkdayForSave = {
        ...workdayAtStartOfEnd,
        status: 'ended',
        endTime: finalizationTimestamp,
        currentJobId: null,
        jobs: (workdayAtStartOfEnd.jobs || []).map(job => ({ ...job })),
        events: (workdayAtStartOfEnd.events || []).map(event => ({ ...event })),
        pauseIntervals: (workdayAtStartOfEnd.pauseIntervals || []).map(pause => ({ ...pause })),
        locationHistory: (workdayAtStartOfEnd.locationHistory || []).map(loc => ({ ...loc })),
      };

      const finalEndLocationCandidate = sanitizeLocationPoint(currentLocation) ||
        (finalizedWorkdayForSave.locationHistory.length > 0 ? sanitizeLocationPoint(finalizedWorkdayForSave.locationHistory[finalizedWorkdayForSave.locationHistory.length - 1]) : null) ||
        sanitizeLocationPoint(finalizedWorkdayForSave.startLocation) ||
        null;

      finalizedWorkdayForSave.endLocation = finalEndLocationCandidate || null;

      // Update pause intervals
      finalizedWorkdayForSave.pauseIntervals = finalizedWorkdayForSave.pauseIntervals.map((pause: PauseInterval) => {
        if (pause.startTime && !pause.endTime) {
          return {
            ...pause,
            endTime: finalizationTimestamp,
            endLocation: finalEndLocationCandidate || undefined,
          };
        }
        return pause;
      });

      // Sanitize
      finalizedWorkdayForSave.startLocation = sanitizeLocationPoint(finalizedWorkdayForSave.startLocation);
      finalizedWorkdayForSave.endLocation = sanitizeLocationPoint(finalizedWorkdayForSave.endLocation);
      finalizedWorkdayForSave.locationHistory = (finalizedWorkdayForSave.locationHistory || [])
        .map(loc => sanitizeLocationPoint(loc))
        .filter(loc => loc !== null) as LocationPoint[];

      // Update jobs
      finalizedWorkdayForSave.jobs = (finalizedWorkdayForSave.jobs || []).map(job => {
        const jobStartLoc = sanitizeLocationPoint(job.startLocation);
        if (!jobStartLoc) {
          // Fallback if start location is missing (should not happen)
          return {
            ...job,
            startLocation: { latitude: 0, longitude: 0, timestamp: job.startTime || Date.now() } as LocationPoint,
            status: 'completed',
            endTime: finalizationTimestamp,
          };
        }
        return {
          ...job,
          status: job.status === 'active' ? 'completed' : (job.status || 'completed'),
          endTime: job.status === 'active' && !job.endTime ? finalizationTimestamp : (job.endTime || undefined),
          endLocation: job.status === 'active' && !job.endLocation ? (finalEndLocationCandidate || undefined) : (sanitizeLocationPoint(job.endLocation) || undefined),
          startLocation: jobStartLoc,
        };
      });

      // Add JOB_COMPLETED events
      const newEvents: TrackingEvent[] = (finalizedWorkdayForSave.jobs || []).map((job: Job) => ({
        id: crypto.randomUUID(),
        type: 'JOB_COMPLETED',
        timestamp: job.endTime || finalizationTimestamp,
        jobId: job.id || undefined,
        details: `Trabajo completado: ${job.description || ''}. Resumen: ${job.summary || ''}. IA: ${job.aiSummary || 'N/A'}`,
        location: sanitizeLocationPoint(job.endLocation) || sanitizeLocationPoint(job.startLocation) || undefined,
      }));

      finalizedWorkdayForSave.events = [...finalizedWorkdayForSave.events, ...newEvents].map(event => ({
        ...event,
        location: sanitizeLocationPoint(event.location) || undefined
      }));

      // Calculate OSRM driving distances for accurate summary
      let lastPointForDistanceCalc = finalizedWorkdayForSave.startLocation;
      if (finalizedWorkdayForSave.jobs && lastPointForDistanceCalc) {
        for (const job of finalizedWorkdayForSave.jobs) {
          if (job.startLocation) {
            const distMeters = await fetchDrivingDistance(lastPointForDistanceCalc, job.startLocation);
            if (distMeters !== null) {
              job.drivingDistanceKm = distMeters / 1000;
            }
            lastPointForDistanceCalc = job.startLocation;
          }
          if (job.endLocation) {
            lastPointForDistanceCalc = job.endLocation;
          }
        }
      }

      // Final leg from last job to ADMIN-CONFIGURED home location (for return trip payment)
      let homeLocation: LocationPoint | null = null;
      const homeLatStr = process.env.NEXT_PUBLIC_TECHNICIAN_HOME_LAT;
      const homeLonStr = process.env.NEXT_PUBLIC_TECHNICIAN_HOME_LON;

      if (homeLatStr && homeLonStr) {
        const homeLat = parseFloat(homeLatStr);
        const homeLon = parseFloat(homeLonStr);
        if (!isNaN(homeLat) && !isNaN(homeLon)) {
          homeLocation = {
            latitude: homeLat,
            longitude: homeLon,
            timestamp: Date.now(),
          };
        }
      }

      if (homeLocation && lastPointForDistanceCalc) {
        const distMeters = await fetchDrivingDistance(lastPointForDistanceCalc, homeLocation);
        if (distMeters !== null) {
          finalizedWorkdayForSave.finalLegDistanceKm = distMeters / 1000;
        }
      } else if (finalizedWorkdayForSave.endLocation && lastPointForDistanceCalc) {
        // Fallback to end location if no home configured
        const distMeters = await fetchDrivingDistance(lastPointForDistanceCalc, finalizedWorkdayForSave.endLocation);
        if (distMeters !== null) {
          finalizedWorkdayForSave.finalLegDistanceKm = distMeters / 1000;
        }
      }

      // SAVE TO SUPABASE
      await SupabaseService.saveFullWorkday(finalizedWorkdayForSave);

      const successfullySavedWorkday = { ...finalizedWorkdayForSave };
      setWorkday(successfullySavedWorkday);
      toast({ title: "Día Finalizado y Guardado", description: "La sesión de trabajo ha concluido y se ha guardado en la nube." });
      localStorage.removeItem(getLocalStorageKey());

      try {
        const summary = await calculateWorkdaySummary(finalizedWorkdayForSave);
        setEndOfDaySummary(summary);
        setIsSummaryModalOpen(true);
      } catch (summaryError) {
        console.error("Error al calcular el resumen del fin de día:", summaryError);
        toast({ title: "Error de Resumen", description: "No se pudo calcular el resumen de la jornada.", variant: "destructive" });
      }

    } catch (error: unknown) {
      console.error("SUPABASE SAVE ERROR:", error);
      let errorMessage = "Un error desconocido ocurrió durante el guardado en la nube.";
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      toast({
        title: "Error Crítico al Guardar en Nube",
        description: errorMessage,
        variant: "destructive",
        duration: 20000
      });

      if (finalizedWorkdayForSave) {
        setWorkday(workdayAtStartOfEnd);
      }
    } finally {
      setIsSavingToCloud(false);
      setIsLoading(false);
      setPendingEndDayAction(false);
    }
  };

  const handleEndDay = async () => {
    if (!workday) {
      toast({ title: "Error", description: "No se puede finalizar el día sin una jornada activa.", variant: "destructive" });
      return;
    }
    const activeJob = workday.jobs.find(j => j.id === workday.currentJobId && j.status === 'active');

    if (activeJob) {
      setPendingEndDayAction(true);
      setJobToSummarizeId(activeJob.id);
      openJobModal('summary', { description: activeJob.description || '', summary: '' });
      recordEvent('JOB_COMPLETION_PROMPT', currentLocation, activeJob.id, "Prompt al finalizar el día");
      return;
    }
    if (workday) {
      await initiateEndDayProcess(workday);
    }
  };

  const handleJobFormSubmit = async () => {
    if (!workday) return;
    const safeCurrentLocation = sanitizeLocationPoint(currentLocation);

    if (jobModalMode === 'new') {
      if (!safeCurrentLocation) {
        toast({ title: "Ubicación Requerida", description: "No se puede iniciar un nuevo trabajo sin una ubicación válida.", variant: "destructive" });
        return;
      }
      const newJob: Job = {
        id: crypto.randomUUID(),
        description: currentJobFormData.description,
        startTime: pendingJobStartTime || Date.now(),
        startLocation: safeCurrentLocation,
        status: 'active',
      };
      setWorkday(prev => prev ? ({
        ...prev,
        jobs: [...prev.jobs, newJob],
        currentJobId: newJob.id,
      }) : null);
      recordEvent('JOB_START', safeCurrentLocation, newJob.id, `Nuevo trabajo iniciado: ${newJob.description}`);
      toast({ title: "Nuevo Trabajo Iniciado", description: newJob.description });
      setIsJobModalOpen(false);
      setCurrentJobFormData({ description: '', summary: '' });
      setPendingJobStartTime(null);
      setJobToSummarizeId(null);
    } else if (jobModalMode === 'summary') {
      // Robustness: Try to get ID from state, or fallback to current active job
      const targetJobId = jobToSummarizeId || workday.currentJobId;

      if (!targetJobId) {
        toast({ title: "Error Interno", description: "No se identificó el trabajo a completar.", variant: "destructive" });
        return;
      }

      if (!safeCurrentLocation) {
        toast({ title: "Ubicación Requerida", description: "No se puede completar el trabajo sin una ubicación válida.", variant: "destructive" });
        return;
      }

      const jobToUpdateIndex = workday.jobs.findIndex(j => j.id === targetJobId);
      if (jobToUpdateIndex === -1) {
        toast({ title: "Error Interno", description: "No se encontró el trabajo para completar.", variant: "destructive" });
        setCurrentJobFormData({ description: '', summary: '' });
        setJobToSummarizeId(null);
        return;
      }

      const jobBeforeCompletion = workday.jobs[jobToUpdateIndex];
      setWorkday(prev => {
        if (!prev) return null;
        const updatedJobs = [...prev.jobs];
        updatedJobs[jobToUpdateIndex] = {
          ...jobBeforeCompletion,
          summary: currentJobFormData.summary || '',
          status: 'completed',
          endTime: Date.now(),
          endLocation: safeCurrentLocation || undefined,
        };

        return {
          ...prev,
          jobs: updatedJobs,
          currentJobId: null,
        };
      });

      recordEvent('JOB_COMPLETED', safeCurrentLocation, targetJobId, `Trabajo completado. Resumen: ${currentJobFormData.summary}`);
      toast({ title: "Trabajo Completado", description: "El trabajo ha sido registrado." });
      setIsJobModalOpen(false);
      setCurrentJobFormData({ description: '', summary: '' });
      setJobToSummarizeId(null);

      if (pendingEndDayAction) {
        setTimeout(() => {
          // Effect will handle this
        }, 500);
      }
    } else {
      // Fallback for unknown state
      toast({ title: "Error", description: "Estado inválido del formulario.", variant: "destructive" });
    }
  };

  // Effect to handle pending end day action after job completion
  useEffect(() => {
    if (pendingEndDayAction && workday && !workday.currentJobId) {
      // If we were waiting to end the day and now there is no current job, proceed.
      initiateEndDayProcess(workday);
    }
  }, [workday, pendingEndDayAction, initiateEndDayProcess]);


  if (!workday) {
    return (
      <div className="p-4 max-w-md mx-auto space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Iniciar Jornada</CardTitle>
            <CardDescription>Comienza tu día de trabajo registrando tu ubicación y hora de inicio.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <div className="bg-slate-100 p-4 rounded-full">
              <Briefcase className="h-12 w-12 text-slate-500" />
            </div>
            {geolocationError && (
              <div className="text-red-500 text-sm text-center flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                {geolocationError.message}
              </div>
            )}
            {currentLocation ? (
              <div className="text-green-600 text-sm flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                Ubicación lista
              </div>
            ) : (
              <div className="text-amber-600 text-sm flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Obteniendo ubicación...
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button className="w-full" size="lg" onClick={handleStartTracking} disabled={isLoading || !currentLocation}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Iniciar Jornada
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-md mx-auto space-y-4 pb-20">
      {Object.values(aiLoading).some(Boolean) && (
        <div className="fixed top-4 right-4 z-50 animate-in fade-in slide-in-from-top-2 pointer-events-none">
          <div className="bg-purple-900/90 text-white px-3 py-1.5 rounded-full shadow-xl flex items-center gap-2 border border-purple-500/50 backdrop-blur-sm">
            <BrainCircuit className="h-4 w-4 animate-pulse text-purple-300" />
            <span className="text-xs font-semibold">IA Analizando...</span>
          </div>
        </div>
      )}
      {/* Header Card */}
      <Card className="bg-slate-900 text-white border-none shadow-lg">
        <CardContent className="p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2">
                <User className="h-5 w-5 text-slate-400" />
                {technicianName}
              </h2>
              <p className="text-slate-400 text-sm">{new Date(workday.date).toLocaleDateString()}</p>
            </div>
            <div className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${workday.status === 'tracking' ? 'bg-green-500/20 text-green-400' :
              workday.status === 'paused' ? 'bg-amber-500/20 text-amber-400' :
                'bg-slate-700 text-slate-300'
              }`}>
              {workday.status === 'tracking' && <span className="relative flex h-2 w-2 mr-1"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span></span>}
              {workday.status === 'tracking' ? 'ACTIVO' : workday.status === 'paused' ? 'PAUSADO' : 'FINALIZADO'}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-4">
            <div className="bg-slate-800/50 p-3 rounded-lg">
              <div className="text-slate-400 text-xs mb-1 flex items-center gap-1"><Clock className="h-3 w-3" /> Tiempo Activo</div>
              <div className="text-2xl font-mono font-semibold">{formatTime(elapsedTime)}</div>
            </div>
            <div className="bg-slate-800/50 p-3 rounded-lg">
              <div className="text-slate-400 text-xs mb-1 flex items-center gap-1"><MapPinned className="h-3 w-3" /> Distancia</div>
              <div className="text-2xl font-mono font-semibold">{calculateRobustDistance(workday, currentLocation, 1.3).toFixed(2)} km</div>
            </div>
            <div className="bg-slate-800/50 p-3 rounded-lg">
              <div className="text-slate-400 text-xs mb-1 flex items-center gap-1"><Briefcase className="h-3 w-3" /> Trabajos</div>
              <div className="text-2xl font-mono font-semibold">{workday.jobs.filter(j => j.status === 'completed').length} / {workday.jobs.length}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Current Job Card */}
      {workday.status !== 'ended' && (
        <Card className="border-l-4 border-l-blue-500 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex justify-between items-center">
              Trabajo Actual
              {currentJob && <span className="text-xs font-normal px-2 py-1 bg-blue-100 text-blue-700 rounded-full">En Progreso</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {currentJob ? (
              <div className="space-y-3">
                <p className="font-medium text-slate-800">{currentJob.description}</p>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Clock className="h-3 w-3" />
                  Iniciado: {new Date(currentJob.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
                <Button variant="outline" size="sm" className="w-full mt-2" onClick={() => {
                  setJobToSummarizeId(currentJob.id);
                  openJobModal('summary', { description: currentJob.description, summary: '' });
                }}>
                  <CheckCircle className="mr-2 h-4 w-4 text-green-600" />
                  Completar Trabajo
                </Button>
              </div>
            ) : (
              <div className="text-center py-6 text-slate-500 space-y-3">
                <p>No hay trabajo activo en este momento.</p>
                <Button onClick={() => openJobModal('new', { description: '', summary: '' }, Date.now())} disabled={workday.status === 'paused'}>
                  <MapPin className="mr-2 h-4 w-4" />
                  Llegué / Iniciar Trabajo
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Actions Grid */}
      {workday.status !== 'ended' && (
        <div className="grid grid-cols-2 gap-3">
          {workday.status === 'tracking' ? (
            <Button variant="outline" className="h-auto py-4 flex flex-col gap-2 border-amber-200 hover:bg-amber-50 hover:text-amber-700" onClick={handlePauseTracking}>
              <Pause className="h-6 w-6 text-amber-500" />
              <span>Pausar</span>
            </Button>
          ) : (
            <Button variant="outline" className="h-auto py-4 flex flex-col gap-2 border-green-200 hover:bg-green-50 hover:text-green-700" onClick={handleResumeTracking}>
              <Play className="h-6 w-6 text-green-500" />
              <span>Reanudar</span>
            </Button>
          )}

          <Button variant="destructive" className="h-auto py-4 flex flex-col gap-2" onClick={handleEndDay} disabled={isSavingToCloud}>
            {isSavingToCloud ? <Loader2 className="h-6 w-6 animate-spin" /> : <StopCircle className="h-6 w-6" />}
            <span>Finalizar Día</span>
          </Button>
        </div>
      )}

      {/* Location Info */}
      <LocationInfo currentLocation={currentLocation} />

      {/* Job Modal */}
      <Dialog open={isJobModalOpen} onOpenChange={setIsJobModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{jobModalMode === 'new' ? 'Nuevo Trabajo' : 'Completar Trabajo'}</DialogTitle>
            <DialogDescription>
              {jobModalMode === 'new'
                ? '¿Qué estás haciendo?'
                : 'Añade un resumen o notas sobre el trabajo realizado.'}
            </DialogDescription>
          </DialogHeader>

          {/* Activity Type Selection (only for new mode) */}
          {jobModalMode === 'new' && (
            <div className="flex flex-col gap-2 mt-2">
              <Button
                variant={activityType === 'job' ? 'default' : 'outline'}
                className="w-full justify-start h-auto py-3 px-4"
                onClick={() => setActivityType('job')}
              >
                <Briefcase className="mr-3 h-5 w-5" />
                <div className="flex flex-col items-start">
                  <span className="font-medium">Nuevo Trabajo</span>
                  <span className="text-xs text-muted-foreground font-normal">Iniciar una nueva tarea remunerada</span>
                </div>
              </Button>
              <Button
                variant={activityType === 'break' ? 'default' : 'outline'}
                className="w-full justify-start h-auto py-3 px-4"
                onClick={() => setActivityType('break')}
              >
                <Clock className="mr-3 h-5 w-5" />
                <div className="flex flex-col items-start">
                  <span className="font-medium">Pausa Personal</span>
                  <span className="text-xs text-muted-foreground font-normal">Almuerzo, descanso, baño...</span>
                </div>
              </Button>
              <Button
                variant={activityType === 'supplies' ? 'default' : 'outline'}
                className="w-full justify-start h-auto py-3 px-4"
                onClick={() => setActivityType('supplies')}
              >
                <MapPin className="mr-3 h-5 w-5" />
                <div className="flex flex-col items-start">
                  <span className="font-medium">Compra de Insumos</span>
                  <span className="text-xs text-muted-foreground font-normal">Ferretería, materiales, etc.</span>
                </div>
              </Button>
            </div>
          )}
          <div className="grid gap-4 py-4">
            {/* Job Description (for job mode or summary mode) */}
            {(activityType === 'job' || jobModalMode === 'summary') && (
              <div className="grid gap-2">
                <Label htmlFor="description" className="flex items-center gap-2">
                  <MessageSquareText className="h-4 w-4" />
                  {jobModalMode === 'new' ? 'Descripción del Trabajo' : 'Trabajo'}
                </Label>
                <Textarea
                  id="description"
                  value={currentJobFormData.description}
                  onChange={(e) => setCurrentJobFormData({ ...currentJobFormData, description: e.target.value })}
                  placeholder="Ej: Instalación de fibra en Calle Principal 123..."
                  disabled={jobModalMode === 'summary'}
                  className={jobModalMode === 'summary' ? "bg-slate-100" : ""}
                />
                {pendingJobStartTime && jobModalMode === 'new' && (
                  <p className="text-xs text-muted-foreground">
                    ⏱️ Hora de inicio: {new Date(pendingJobStartTime).toLocaleTimeString()}
                  </p>
                )}
              </div>
            )}

            {/* Personal Break / Supply Run Reason */}
            {(activityType === 'break' || activityType === 'supplies') && jobModalMode === 'new' && (
              <div className="grid gap-2">
                <Label htmlFor="breakReason" className="flex items-center gap-2">
                  <MessageSquareText className="h-4 w-4" />
                  {activityType === 'supplies' ? 'Detalle de Compra' : 'Motivo de la Pausa'}
                </Label>
                <Textarea
                  id="breakReason"
                  value={personalBreakReason}
                  onChange={(e) => setPersonalBreakReason(e.target.value)}
                  placeholder={activityType === 'supplies'
                    ? "Ej: Ferretería - cables, conectores..."
                    : "Ej: Fui a comprar comida, Descanso, etc."}
                />
              </div>
            )}

            {jobModalMode === 'summary' && (
              <div className="grid gap-2">
                <Label htmlFor="summary" className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4" />
                  Resumen de Cierre
                </Label>
                <div className="relative">
                  <Textarea
                    id="summary"
                    value={currentJobFormData.summary}
                    onChange={(e) => setCurrentJobFormData({ ...currentJobFormData, summary: e.target.value })}
                    placeholder="Ej: Instalación exitosa, señal verificada."
                    className="pr-10"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute right-2 top-2 h-6 w-6 text-purple-600 hover:text-purple-700 hover:bg-purple-100"
                    title="Generar resumen con IA"
                    onClick={async () => {
                      if (!currentJobFormData.description) return;
                      setIsLoading(true);
                      try {
                        const result = await summarizeJobDescription({
                          jobDescription: currentJobFormData.description,
                          additionalNotes: currentJobFormData.summary
                        });
                        setCurrentJobFormData(prev => ({ ...prev, summary: result.summary }));
                        toast({ title: "Resumen Generado", description: "La IA ha generado un resumen de tu trabajo." });
                      } catch (error) {
                        console.error(error);
                        toast({ title: "Error IA", description: "No se pudo generar el resumen.", variant: "destructive" });
                      } finally {
                        setIsLoading(false);
                      }
                    }}
                    disabled={isLoading || !currentJobFormData.description}
                  >
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setIsJobModalOpen(false)}>Cancelar</Button>
            {jobModalMode === 'new' && (activityType === 'break' || activityType === 'supplies') ? (
              <Button
                onClick={() => {
                  const eventType = activityType === 'supplies' ? 'Compra de insumos' : 'Pausa personal';
                  recordEvent('USER_ACTION', currentLocation, undefined, `${eventType}: ${personalBreakReason || 'Sin detalle especificado'}`);
                  toast({ title: activityType === 'supplies' ? "Compra Registrada" : "Pausa Registrada", description: personalBreakReason || "Actividad registrada." });
                  handlePauseTracking();
                  setIsJobModalOpen(false);
                  setPersonalBreakReason('');
                }}
              >
                {activityType === 'supplies' ? 'Registrar Compra' : 'Registrar Pausa'}
              </Button>
            ) : (
              <Button onClick={handleJobFormSubmit} disabled={!currentJobFormData.description}>
                {jobModalMode === 'new' ? 'Iniciar Trabajo' : 'Guardar y Completar'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Summary Modal */}
      <Dialog open={isSummaryModalOpen} onOpenChange={setIsSummaryModalOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Resumen de Jornada</DialogTitle>
            <DialogDescription>Resumen completo de tu actividad diaria.</DialogDescription>
          </DialogHeader>

          {endOfDaySummary && <WorkdaySummaryDisplay summary={endOfDaySummary} />}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cerrar</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
