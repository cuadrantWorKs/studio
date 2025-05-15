
"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { MapPin, Play, Pause, StopCircle, Briefcase, Clock, CheckCircle, AlertTriangle, Loader2, History, CloudUpload, User } from 'lucide-react';
import type { LocationPoint, Job, TrackingStatus, TrackingEvent, Workday, PauseInterval, GeolocationError, WorkdaySummaryContext } from '@/lib/techtrack/types';
import { haversineDistance } from '@/lib/techtrack/geometry';
import { summarizeJobDescription } from '@/ai/flows/summarize-job-description';
import { decidePromptForNewJob } from '@/ai/flows/decide-prompt-for-new-job';
import { decidePromptForJobCompletion } from '@/ai/flows/decide-prompt-for-job-completion';
import { formatTime } from '@/lib/utils';
import { calculateWorkdaySummary } from '@/lib/techtrack/summary';
import WorkdaySummaryDisplay from './WorkdaySummaryDisplay';
import { db } from '@/lib/firebase';
import { doc, setDoc } from 'firebase/firestore';


const LOCATION_INTERVAL_MS = 5 * 60 * 1000;
const STOP_DETECT_DURATION_MS = 15 * 60 * 1000;
const MOVEMENT_THRESHOLD_METERS = 100;
const RECENT_PROMPT_THRESHOLD_MS = 30 * 60 * 1000;
const LOCAL_STORAGE_CURRENT_WORKDAY_KEY_PREFIX = 'TECHTRACK_CURRENT_WORKDAY_';


interface TechTrackAppProps {
  technicianName: string;
}

export default function TechTrackApp({ technicianName }: TechTrackAppProps) {
  const [workday, setWorkday] = useState<Workday | null>(null);
  const [currentLocation, setCurrentLocation] = useState<LocationPoint | null>(null);
  const [geolocationError, setGeolocationError] = useState<GeolocationError | null>(null);

  const [elapsedTime, setElapsedTime] = useState(0);
  const [isJobModalOpen, setIsJobModalOpen] = useState(false);
  const [jobModalMode, setJobModalMode] = useState<'new' | 'summary'>('new');
  const [currentJobFormData, setCurrentJobFormData] = useState({ description: '', summary: '' });
  const [jobToSummarizeId, setJobToSummarizeId] = useState<string | null>(null);

  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);
  const [endOfDaySummary, setEndOfDaySummary] = useState<WorkdaySummaryContext | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingToCloud, setIsSavingToCloud] = useState(false);
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});
  const [pendingEndDayAction, setPendingEndDayAction] = useState(false);

  const { toast } = useToast();

  const getCurrentFormattedDate = () => new Date().toISOString().split('T')[0];
  const getLocalStorageKey = useCallback(() => `${LOCAL_STORAGE_CURRENT_WORKDAY_KEY_PREFIX}${technicianName}`, [technicianName]);


  useEffect(() => {
    const localStorageKey = getLocalStorageKey();
    const savedWorkdayJson = localStorage.getItem(localStorageKey);
    if (savedWorkdayJson) {
      try {
        const savedWorkday = JSON.parse(savedWorkdayJson) as Workday;
        if (savedWorkday.status !== 'ended' && savedWorkday.userId === technicianName) {
            setWorkday(savedWorkday);
        } else {
            localStorage.removeItem(localStorageKey);
        }
      } catch (e) {
        console.error("Error parsing workday from localStorage", e);
        localStorage.removeItem(localStorageKey);
      }
    }
  }, [technicianName, getLocalStorageKey]);

  useEffect(() => {
    const localStorageKey = getLocalStorageKey();
    if (workday && workday.status !== 'ended' && workday.userId === technicianName) {
      localStorage.setItem(localStorageKey, JSON.stringify(workday));
    }
  }, [workday, technicianName, getLocalStorageKey]);


  const currentJob = useMemo(() => {
    if (!workday?.currentJobId) return null;
    return workday.jobs.find(j => j.id === workday.currentJobId);
  }, [workday]);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          const newLocation: LocationPoint = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp,
          };
          setCurrentLocation(newLocation);
          setGeolocationError(null);
        },
        (error) => {
          setGeolocationError({ code: error.code, message: error.message });
          toast({ title: "Error de Geolocalización", description: error.message, variant: "destructive" });
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, [toast]);

  const recordEvent = useCallback((type: TrackingEvent['type'], locationParam?: LocationPoint | null, jobId?: string, details?: string) => {
    setWorkday(prev => {
      if (!prev) return null;
      const eventLocation = locationParam === undefined ? (currentLocation ?? undefined) : (locationParam ?? undefined);
      const newEvent: TrackingEvent = {
        id: crypto.randomUUID(),
        type,
        timestamp: Date.now(),
        jobId,
        details
      };
      if (eventLocation) {
        newEvent.location = eventLocation;
      }
      return { ...prev, events: [...prev.events, newEvent] };
    });
  }, [currentLocation]);


  useEffect(() => {
    let intervalId: NodeJS.Timeout | undefined = undefined;

    if (workday?.status === 'tracking') {
      intervalId = setInterval(() => {
        const now = Date.now();
        let activeTime = now - (workday.startTime || now);
        workday.pauseIntervals.forEach(p => {
          if (p.endTime && p.startTime) {
            activeTime -= (p.endTime - p.startTime);
          }
        });
        setElapsedTime(activeTime < 0 ? 0 : activeTime);
      }, 1000);
    } else if (workday?.status === 'paused' || workday?.status === 'ended') {
        const baseTime = (workday.endTime || workday.pauseIntervals.find(p => !p.endTime)?.startTime || Date.now());
        let activeTime = (baseTime) - (workday.startTime || baseTime) ;
         workday.pauseIntervals.forEach(p => {
          if (p.endTime && p.startTime) {
             if (!(workday.status === 'paused' && p.startTime === workday.pauseIntervals[workday.pauseIntervals.length-1]?.startTime && !p.endTime)) {
                 activeTime -= (p.endTime - p.startTime);
             }
          }
        });
        setElapsedTime(activeTime < 0 ? 0 : activeTime);
    } else if (workday?.status === 'idle'){
        setElapsedTime(0);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [workday]);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    if (workday?.status === 'tracking') {
      intervalId = setInterval(() => {
        if (currentLocation) {
          setWorkday(prev => prev ? ({ ...prev, locationHistory: [...prev.locationHistory, currentLocation] }) : null);
          recordEvent('LOCATION_UPDATE', currentLocation, undefined, "Actualización periódica de 5 min");
        }
      }, LOCATION_INTERVAL_MS);
    }
    return () => clearInterval(intervalId);
  }, [workday?.status, currentLocation, recordEvent]);

  useEffect(() => {
    if (workday?.status === 'tracking' && !currentJob) {
      const lastMovementTime = workday.locationHistory[workday.locationHistory.length -1]?.timestamp || workday.startTime;
      if (Date.now() - (lastMovementTime || Date.now()) > STOP_DETECT_DURATION_MS) {
        const hasBeenPromptedRecently = workday.lastNewJobPromptTime && (Date.now() - workday.lastNewJobPromptTime < RECENT_PROMPT_THRESHOLD_MS);

        if(isJobModalOpen) return;

        setAiLoading(prev => ({...prev, newJob: true}));
        decidePromptForNewJob({ hasBeenPromptedRecently: !!hasBeenPromptedRecently, timeStoppedInMinutes: Math.round(STOP_DETECT_DURATION_MS / (60*1000)) })
          .then(res => {
            if (res.shouldPrompt) {
              toast({ title: "¿Nuevo Trabajo?", description: "Parece que te has detenido. ¿Comenzando un nuevo trabajo? IA: " + res.reason });
              setJobModalMode('new');
              setIsJobModalOpen(true);
              recordEvent('NEW_JOB_PROMPT', currentLocation, undefined, `IA: ${res.reason}`);
            }
            setWorkday(prev => prev ? ({...prev, lastNewJobPromptTime: Date.now()}) : null);
          })
          .catch(err => {
            console.error("AI Error (decidePromptForNewJob):", err);
            toast({ title: "Error de IA", description: "No se pudo verificar si hay un nuevo trabajo.", variant: "destructive" });
          })
          .finally(() => setAiLoading(prev => ({...prev, newJob: false})));
      }
    }
  }, [workday, currentLocation, toast, recordEvent, currentJob, isJobModalOpen]);

  useEffect(() => {
    if (workday?.status === 'tracking' && currentJob && currentJob.status === 'active' && currentLocation) {
        const jobStartLocation = currentJob.startLocation;
        if (!jobStartLocation) return;

        const distance = haversineDistance(jobStartLocation, currentLocation);
        if (distance > MOVEMENT_THRESHOLD_METERS) {
          const lastPromptTime = workday.lastJobCompletionPromptTime;

          if(isJobModalOpen) return;

          setAiLoading(prev => ({...prev, jobCompletion: true}));
          decidePromptForJobCompletion({ distanceMovedMeters: distance, lastJobPromptedTimestamp: lastPromptTime })
            .then(res => {
              if (res.shouldPrompt) {
                toast({ title: "¿Actualizar Trabajo?", description: `Te has movido significativamente. ¿Completaste el trabajo: ${currentJob.description}? IA: ${res.reason}` });
                setJobToSummarizeId(currentJob.id);
                setJobModalMode('summary');
                setCurrentJobFormData({ description: currentJob.description || '', summary: '' });
                setIsJobModalOpen(true);
                recordEvent('JOB_COMPLETION_PROMPT', currentLocation, currentJob.id, `IA: ${res.reason}`);
              }
              setWorkday(prev => prev ? ({...prev, lastJobCompletionPromptTime: Date.now()}) : null);
            })
            .catch(err => {
              console.error("AI Error (decidePromptForJobCompletion):", err);
              toast({ title: "Error de IA", description: "No se pudo verificar la finalización del trabajo.", variant: "destructive" });
            })
            .finally(() => setAiLoading(prev => ({...prev, jobCompletion: false})));
        }
    }
  }, [workday, currentJob, currentLocation, toast, recordEvent, isJobModalOpen]);


  const handleStartTracking = () => {
    if (!currentLocation) {
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
      startLocation: currentLocation,
      status: 'tracking',
      locationHistory: [currentLocation],
      jobs: [],
      events: [{ id: crypto.randomUUID(), type: 'SESSION_START', timestamp: startTime, location: currentLocation, details: `Sesión iniciada por ${technicianName}` }],
      pauseIntervals: [],
    };
    setWorkday(newWorkday);
    toast({ title: "Seguimiento Iniciado", description: "Tu jornada laboral ha comenzado." });

    setTimeout(() => {
        setJobModalMode('new');
        setCurrentJobFormData({ description: '', summary: '' });
        setIsJobModalOpen(true);
        recordEvent('NEW_JOB_PROMPT', currentLocation, undefined, "Prompt inicial después del inicio de sesión");
    }, 100);
    setIsLoading(false);
  };

  const handlePauseTracking = () => {
    if (!workday) return;
    setIsLoading(true);
    const now = Date.now();
    const newPauseInterval: PauseInterval = {
      startTime: now,
      startLocation: currentLocation ?? undefined
    };
    setWorkday(prev => prev ? ({
      ...prev,
      status: 'paused',
      pauseIntervals: [...prev.pauseIntervals, newPauseInterval],
    }) : null);
    recordEvent('SESSION_PAUSE', currentLocation);
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
          currentPause.endLocation = currentLocation ?? undefined;
        }
      }
      return { ...prev, status: 'tracking', pauseIntervals: updatedPauses };
    });
    recordEvent('SESSION_RESUME', currentLocation);
    toast({ title: "Seguimiento Reanudado" });
    setIsLoading(false);
  };

  const initiateEndDayProcess = async (workdayDataToEnd: Workday) => {
    if (!workdayDataToEnd) {
        console.error("initiateEndDayProcess called with null workdayDataToEnd");
        toast({ title: "Error Interno", description: "No se pueden finalizar los datos del día.", variant: "destructive"});
        setIsLoading(false);
        setIsSavingToCloud(false);
        return;
    }
    const actionTime = Date.now();
    setIsLoading(true);
    setIsSavingToCloud(true);

    setWorkday(prev => {
        if (!prev) return null;
        let tempWorkday = { ...workdayDataToEnd };

        if (tempWorkday.status === 'paused' && tempWorkday.pauseIntervals.length > 0) {
            const lastPause = tempWorkday.pauseIntervals[tempWorkday.pauseIntervals.length - 1];
            if (lastPause.startTime && !lastPause.endTime) {
                lastPause.endTime = actionTime;
                lastPause.endLocation = currentLocation ?? undefined;
            }
        }
        return {
            ...tempWorkday,
            status: 'paused',
            endTime: actionTime,
        };
    });

    await finalizeWorkdayAndSave(workdayDataToEnd, actionTime);
  };


  const finalizeWorkdayAndSave = async (workdayAtStartOfEnd: Workday, finalizationTimestamp: number) => {
    console.log("Starting finalizeWorkdayAndSave for workday ID:", workdayAtStartOfEnd.id);
    if (!db) {
      console.error("Firestore DB instance is not available. Check Firebase initialization.");
      toast({
        title: "Error de Configuración",
        description: "No se puede conectar a la base de datos. Revisa la configuración de Firebase.",
        variant: "destructive",
        duration: 10000
      });
      setIsSavingToCloud(false);
      setIsLoading(false);
      setPendingEndDayAction(false);
      setWorkday(prev => prev ? ({...prev, status: workdayAtStartOfEnd.status, endTime: undefined }) : null);
      return;
    }

    const endLocationToUse = currentLocation ??
                             (workdayAtStartOfEnd.locationHistory.length > 0 ? workdayAtStartOfEnd.locationHistory[workdayAtStartOfEnd.locationHistory.length - 1] : null) ??
                             workdayAtStartOfEnd.startLocation ??
                             null;

    let tempWorkdayState = { ...workdayAtStartOfEnd };

    if (tempWorkdayState.status === 'paused' && tempWorkdayState.pauseIntervals.length > 0) {
        const lastPause = tempWorkdayState.pauseIntervals[tempWorkdayState.pauseIntervals.length - 1];
        if (lastPause.startTime && !lastPause.endTime) {
            lastPause.endTime = finalizationTimestamp;
            lastPause.endLocation = currentLocation ?? undefined;
        }
    }

    const finalizedWorkdayForSave: Workday = {
      ...tempWorkdayState,
      status: 'ended',
      endTime: finalizationTimestamp,
      endLocation: endLocationToUse, // Will be null if not available
      events: [...tempWorkdayState.events, {
          id: crypto.randomUUID(),
          type: 'SESSION_END',
          timestamp: finalizationTimestamp,
          location: endLocationToUse, // Will be null if not available
          details: `Sesión finalizada por ${technicianName}`
      }]
    };

    const dataToSave = JSON.parse(JSON.stringify(finalizedWorkdayForSave));
    console.log("Data prepared for Firestore:", dataToSave);

    try {
      console.log("Attempting to save workday to Firestore, ID:", dataToSave.id);
      const workdayDocRef = doc(db, "workdays", dataToSave.id);
      await setDoc(workdayDocRef, dataToSave);
      console.log("Workday successfully saved to Firestore with ID:", dataToSave.id);

      setWorkday(finalizedWorkdayForSave);

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

    } catch (error) {
      console.error("FIRESTORE SAVE ERROR: Failed to save workday to Firestore.");
      console.error("Workday ID being saved:", finalizedWorkdayForSave.id);
      console.error("Full error object:", error);
      if (error instanceof Error) {
        console.error("Error name:", error.name);
        console.error("Error message:", error.message);
        console.error("Error stack:", error.stack);
      }
      if (error && typeof error === 'object' && 'code' in error) {
        console.error("Firebase Error Code:", (error as {code: string}).code);
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      toast({
        title: "Error Crítico al Guardar en Nube",
        description: `No se pudo guardar. Error: ${errorMessage}. Revisa la consola para más detalles.`,
        variant: "destructive",
        duration: 15000
      });
      setWorkday(prev => {
        if (!prev) return null;
        return {...prev, status: workdayAtStartOfEnd.status, endTime: undefined };
      });
    } finally {
      console.log("FINALLY block in finalizeWorkdayAndSave. Setting isSavingToCloud and isLoading to false.");
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
      setJobModalMode('summary');
      setCurrentJobFormData({ description: activeJob.description || '', summary: '' });
      setIsJobModalOpen(true);
      recordEvent('JOB_COMPLETION_PROMPT', currentLocation, activeJob.id, "Prompt al finalizar el día");
      return;
    }
    // Pass the current workday state to initiateEndDayProcess
    if (workday) { // Ensure workday is not null before calling
        await initiateEndDayProcess(workday);
    }
  };

  const handleJobFormSubmit = () => {
    if (!workday) return;

    if (jobModalMode === 'new') {
      const newJob: Job = {
        id: crypto.randomUUID(),
        description: currentJobFormData.description,
        startTime: Date.now(),
        startLocation: currentLocation ?? { latitude: 0, longitude: 0, timestamp: Date.now(), accuracy: 0 }, // Default if no location
        status: 'active',
      };
      setWorkday(prev => prev ? ({
        ...prev,
        jobs: [...prev.jobs, newJob],
        currentJobId: newJob.id,
      }) : null);
      recordEvent('JOB_START', currentLocation, newJob.id, `Nuevo trabajo iniciado: ${newJob.description}`);
      toast({ title: "Nuevo Trabajo Iniciado", description: newJob.description });
      setIsJobModalOpen(false);
      setCurrentJobFormData({ description: '', summary: '' });
      setJobToSummarizeId(null);
    } else if (jobModalMode === 'summary' && jobToSummarizeId) {
      setAiLoading(prev => ({...prev, summarize: true}));

      let completedWorkdayForSave: Workday | null = null;

      const updateLocalWorkdayStateWithCompletedJob = (aiSummaryValue?: string | null) => {
        let updatedWorkday: Workday | null = null;
        setWorkday(prev => {
          if (!prev) return null;
          updatedWorkday = {
            ...prev,
            jobs: prev.jobs.map(j => {
              if (j.id === jobToSummarizeId) {
                const jobUpdatePayload: Partial<Job> = {
                  summary: currentJobFormData.summary,
                  status: 'completed',
                  endTime: Date.now(),
                  endLocation: currentLocation ?? undefined,
                };
                if (aiSummaryValue !== undefined && aiSummaryValue !== null) {
                  jobUpdatePayload.aiSummary = aiSummaryValue;
                } else {
                  delete jobUpdatePayload.aiSummary;
                }
                const finalJob = { ...j, ...jobUpdatePayload };
                if (finalJob.endLocation === undefined) delete finalJob.endLocation;
                return finalJob as Job;
              }
              return j;
            }),
            currentJobId: null,
          };
          completedWorkdayForSave = updatedWorkday;
          return updatedWorkday;
        });
      };

      summarizeJobDescription({ jobDescription: currentJobFormData.summary })
        .then(aiRes => {
          recordEvent('JOB_COMPLETED', currentLocation, jobToSummarizeId, `Trabajo completado. Usuario: ${currentJobFormData.summary}, IA: ${aiRes.summary}`);
          toast({ title: "Trabajo Completado", description: `Resumen guardado para el trabajo.` });
          updateLocalWorkdayStateWithCompletedJob(aiRes.summary);
        })
        .catch(err => {
          console.error("AI Error (summarizeJobDescription):", err);
          toast({ title: "Error de IA", description: "No se pudo generar el resumen de IA. Trabajo guardado sin él.", variant: "destructive" });
          recordEvent('JOB_COMPLETED', currentLocation, jobToSummarizeId, `Trabajo completado (falló resumen IA). Usuario: ${currentJobFormData.summary}`);
          updateLocalWorkdayStateWithCompletedJob(null);
        })
        .finally(() => {
          setAiLoading(prev => ({...prev, summarize: false}));
          setIsJobModalOpen(false);

          if (pendingEndDayAction && completedWorkdayForSave) {
            initiateEndDayProcess(completedWorkdayForSave); // Pass the updated workday
          } else if (!pendingEndDayAction) {
              setCurrentJobFormData({ description: '', summary: '' });
              setJobToSummarizeId(null);
          }
        });
      return;
    }
  };

  const handleManualStartNewJob = () => {
    if (!currentLocation) {
      toast({ title: "Ubicación Requerida", description: "No se puede iniciar un nuevo trabajo sin ubicación.", variant: "destructive" });
      return;
    }
    setJobModalMode('new');
    setCurrentJobFormData({ description: '', summary: '' });
    setIsJobModalOpen(true);
    recordEvent('USER_ACTION', currentLocation, undefined, "Modal de nuevo trabajo abierto manualmente");
  };

  const handleManualCompleteJob = () => {
    if (!currentJob) return;
    setJobToSummarizeId(currentJob.id);
    setJobModalMode('summary');
    setCurrentJobFormData({ description: currentJob.description || '', summary: '' });
    setIsJobModalOpen(true);
    recordEvent('USER_ACTION', currentLocation, currentJob.id, "Modal de completar trabajo abierto manualmente");
  };

  const CurrentStatusDisplay = () => {
    if (!workday) return <p className="text-muted-foreground">Presiona "Iniciar Seguimiento" para comenzar tu día.</p>;

    let statusText = "Desconocido";
    let IconComponent = AlertTriangle;

    switch (workday.status) {
      case 'idle': statusText = "Listo para Empezar"; IconComponent = Play; break;
      case 'tracking': statusText = "Seguimiento Activo"; IconComponent = Clock; break;
      case 'paused': statusText = "Seguimiento Pausado"; IconComponent = Pause; break;
      case 'ended': statusText = "Día Finalizado"; IconComponent = StopCircle; break;
    }
    return (
      <div className="flex items-center space-x-2">
        <IconComponent className="h-5 w-5 text-accent" />
        <span>{statusText}</span>
      </div>
    );
  };

  const ActionButton = () => {
    const commonDisabled = isLoading || isSavingToCloud;
    if (!workday || workday.status === 'idle') {
      return <Button onClick={handleStartTracking} disabled={!currentLocation || commonDisabled} className="w-full" size="lg">
        {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-5 w-5" />} Iniciar Seguimiento
      </Button>;
    }
    if (workday.status === 'tracking') {
      return (
        <div className="grid grid-cols-2 gap-4">
          <Button onClick={handlePauseTracking} variant="outline" disabled={commonDisabled} className="w-full" size="lg">
            {isLoading && !isSavingToCloud ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pause className="mr-2 h-5 w-5" />} Pausar
          </Button>
          <Button onClick={handleEndDay} variant="destructive" disabled={commonDisabled} className="w-full" size="lg">
             {isSavingToCloud ? <CloudUpload className="mr-2 h-5 w-5 animate-pulse" /> : (isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> :<StopCircle className="mr-2 h-5 w-5" />)}
              Finalizar Día
          </Button>
        </div>
      );
    }
    if (workday.status === 'paused') {
       return (
        <div className="grid grid-cols-2 gap-4">
          <Button onClick={handleResumeTracking} disabled={commonDisabled} className="w-full" size="lg">
            {isLoading && !isSavingToCloud ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-5 w-5" />} Reanudar
          </Button>
          <Button onClick={handleEndDay} variant="destructive" disabled={commonDisabled} className="w-full" size="lg">
            {isSavingToCloud ? <CloudUpload className="mr-2 h-5 w-5 animate-pulse" /> : (isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <StopCircle className="mr-2 h-5 w-5" />)}
             Finalizar Día
          </Button>
        </div>
      );
    }
     if (workday.status === 'ended') {
      return (
        <div className="w-full space-y-2">
            <Button onClick={() => {setWorkday(null); setElapsedTime(0); setEndOfDaySummary(null); setPendingEndDayAction(false);}} variant="secondary" className="w-full" size="lg">Iniciar Nuevo Día</Button>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col min-h-screen items-center justify-center p-4 bg-background text-foreground">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader>
          <div className="flex justify-between items-center space-x-2">
            <Link href="/history" passHref legacyBehavior>
              <Button variant="outline" size="sm" asChild>
                <a><History className="mr-1 h-4 w-4" /> Historial Empresa</a>
              </Button>
            </Link>
            <div className="flex-grow text-center">
                <CardTitle className="text-3xl font-bold text-primary">TechTrack</CardTitle>
                <CardDescription className="flex items-center justify-center">
                    <User className="mr-1 h-4 w-4 text-muted-foreground"/> Bienvenido, {technicianName}.
                </CardDescription>
            </div>
            <div className="w-auto min-w-[calc(110px)]"> {/* Adjusted placeholder for balance */}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="p-4 border rounded-lg bg-secondary/30">
            <CurrentStatusDisplay />
            {workday && (workday.status === 'tracking' || workday.status === 'paused') && (
              <p className="text-4xl font-mono font-bold text-center mt-2">{formatTime(elapsedTime)}</p>
            )}
             {workday?.status === 'ended' && endOfDaySummary && (
                 <p className="text-sm text-muted-foreground text-center mt-2">Tiempo total activo: {formatTime(endOfDaySummary.totalActiveTime)}</p>
             )}
          </div>

          {currentLocation && (
            <div className="text-xs text-muted-foreground flex items-center space-x-1">
              <MapPin className="h-3 w-3" />
              <span>Lat: {currentLocation.latitude.toFixed(4)}, Lon: {currentLocation.longitude.toFixed(4)} (Acc: {currentLocation.accuracy?.toFixed(0)}m)</span>
            </div>
          )}
          {geolocationError && <p className="text-xs text-destructive">Error de Geolocalización: {geolocationError.message}</p>}

          {currentJob && currentJob.status === 'active' && (
            <Card className="bg-accent/10">
              <CardHeader className="p-3">
                <CardTitle className="text-sm flex items-center"><Briefcase className="mr-2 h-4 w-4 text-accent"/>Trabajo Actual</CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <p className="text-sm">{currentJob.description}</p>
              </CardContent>
              <CardFooter className="p-3">
                <Button onClick={handleManualCompleteJob} size="sm" className="w-full" disabled={isLoading || isSavingToCloud}>
                  <CheckCircle className="mr-2 h-4 w-4" /> Completar Este Trabajo
                </Button>
              </CardFooter>
            </Card>
          )}

          {workday?.status === 'tracking' && !currentJob && (
            <Button onClick={handleManualStartNewJob} variant="outline" className="w-full mt-2" disabled={isLoading || isSavingToCloud}>
              <Briefcase className="mr-2 h-4 w-4" /> Iniciar Nuevo Trabajo
            </Button>
          )}

          {(aiLoading.newJob || aiLoading.jobCompletion || aiLoading.summarize) && (
            <div className="flex items-center justify-center text-sm text-muted-foreground pt-2">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              <span>IA está pensando...</span>
            </div>
          )}

        </CardContent>
        <CardFooter>
          <ActionButton />
        </CardFooter>
      </Card>

      <Dialog open={isJobModalOpen} onOpenChange={(open) => {
        if (pendingEndDayAction && jobModalMode === 'summary' && !open && !aiLoading.summarize && !isSavingToCloud) {
            toast({title: "Acción Requerida", description: "Por favor, complete los detalles del trabajo antes de finalizar el día.", variant: "default"});
            return;
        }
        setIsJobModalOpen(open);
        if (!open) {
            if (pendingEndDayAction && jobModalMode === 'summary' && !aiLoading.summarize && !isSavingToCloud) {
                setPendingEndDayAction(false);
                toast({ title: "Finalización de Día Cancelada", description: "Se canceló la finalización del trabajo. El día no ha finalizado.", variant: "default" });
            }
            setCurrentJobFormData({ description: '', summary: '' });
            setJobToSummarizeId(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{jobModalMode === 'new' ? 'Iniciar Nuevo Trabajo' : 'Completar Trabajo'}</DialogTitle>
            <DialogDescription>
              {jobModalMode === 'new' ? 'Ingrese los detalles para el nuevo trabajo.' : `Proporcione un resumen para: ${currentJobFormData.description}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {jobModalMode === 'new' && (
              <div className="space-y-2">
                <Label htmlFor="jobDescription">Descripción del Trabajo</Label>
                <Textarea
                  id="jobDescription"
                  value={currentJobFormData.description}
                  onChange={(e) => setCurrentJobFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Ej: Reparación de A/C en Calle Falsa 123"
                />
              </div>
            )}
            {jobModalMode === 'summary' && (
              <div className="space-y-2">
                <Label htmlFor="jobSummary">Resumen del Trabajo</Label>
                <Textarea
                  id="jobSummary"
                  value={currentJobFormData.summary}
                  onChange={(e) => setCurrentJobFormData(prev => ({ ...prev, summary: e.target.value }))}
                  placeholder="Ej: Se reemplazó el capacitor y se limpiaron las bobinas."
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" onClick={() => {
                 if (!pendingEndDayAction || jobModalMode !== 'summary') {
                    setCurrentJobFormData({ description: '', summary: '' });
                    setJobToSummarizeId(null);
                    setIsJobModalOpen(false);
                 } else {
                    // If pendingEndDayAction is true and it's summary mode, onOpenChange handles it
                 }
              }}>Cancelar</Button>
            </DialogClose>
            <Button onClick={handleJobFormSubmit} disabled={aiLoading.summarize || isLoading || isSavingToCloud}>
              {(aiLoading.summarize || isLoading || isSavingToCloud) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {jobModalMode === 'new' ? 'Iniciar Trabajo' : 'Completar Trabajo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isSummaryModalOpen} onOpenChange={setIsSummaryModalOpen}>
        <DialogContent className="max-w-lg">
          {endOfDaySummary ? (
             <WorkdaySummaryDisplay summary={endOfDaySummary} showTitle={true} />
          ) : (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="mr-2 h-6 w-6 animate-spin" />
              <p>Calculando resumen...</p>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button onClick={() => setEndOfDaySummary(null)}>Cerrar</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
