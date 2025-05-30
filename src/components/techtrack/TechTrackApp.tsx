"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';

import Link from 'next/link';

import { Button } from '@/components/ui/button';

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';

import { Textarea } from '@/components/ui/textarea';

import { useToast } from '@/hooks/use-toast';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import WorkdaySummaryDisplay from './WorkdaySummaryDisplay'; // Importing WorkdaySummaryDisplay
// Import the function from your workday library
import {
  // Import the function from your workday library
  syncLocalDataToSupabase,
 initiateEndDayProcess} from '@/lib/techtrack/workday';
import { Play, Pause, StopCircle, Briefcase, Clock, CheckCircle, AlertTriangle,
  Loader2, History, CloudUpload, User, Ban, MapPinned } from 'lucide-react';

import { haversineDistance } from '@/lib/techtrack/geometry';
import { summarizeJobDescription } from '@/ai/flows/summarize-job-description';
import { db as localDb } from '@/db';
import WorkdaySummaryDisplay from './WorkdaySummaryDisplay'; // Importing WorkdaySummaryDisplay
import { decidePromptForNewJob } from '@/ai/flows/decide-prompt-for-new-job';
import { decidePromptForJobCompletion } from '@/ai/flows/decide-prompt-for-job-completion';
import CurrentStatusDisplay from './CurrentStatusDisplay'; // Import the new component

import { Label } from '@/components/ui/label'; // Import the Label component from your UI library
import { formatTime } from '@/lib/utils';
import LocationInfo from './LocationInfo';
import type {
  LocationPoint, Job, TrackingEvent, Workday, PauseInterval, // eslint-disable-next-line @typescript-eslint/no-unused-vars
 GeolocationError, WorkdaySummaryContext, TrackingEventType

} from '@/lib/techtrack/types';


const STOP_DETECT_DURATION_MS = 15 * 60 * 1000;
const MOVEMENT_THRESHOLD_METERS = 100;
const RECENT_PROMPT_THRESHOLD_MS = 30 * 60 * 1000;
const LOCAL_STORAGE_CURRENT_WORKDAY_KEY_PREFIX = 'TECHTRACK_CURRENT_WORKDAY_';


interface TechTrackAppProps {
  technicianName: string;
}


// Placeholder for CurrentStatusDisplay
// Helper function to sanitize location point data for Firestore
export const sanitizeLocationPoint = (location?: LocationPoint | null | undefined): LocationPoint | undefined => {
 if ( location && typeof location.latitude === 'number' && !isNaN(location.latitude) && typeof location.longitude === 'number' && !isNaN(location.longitude) && typeof location.timestamp === 'number' && !isNaN(location.timestamp) ) { // Create a new object to ensure immutability and correct structure
    const sanitized: LocationPoint = { latitude: location.latitude, longitude: location.longitude, timestamp: location.timestamp }; if (typeof location.accuracy === 'number' && !isNaN(location.accuracy)) { sanitized.accuracy = location.accuracy;
    } // No need to include accuracy if not a number
    return sanitized; // Return sanitized LocationPoint or undefined
  }
  return undefined;
};

export function TechTrackApp({ technicianName }: TechTrackAppProps): JSX.Element {
  const [workday, setWorkday] = useState<Workday | null>(null);
  const [currentLocation, setCurrentLocation] = useState<LocationPoint | null>(null);
  const [geolocationError, setGeolocationError] = useState<GeolocationError | null>(null); // Keep this for user feedback

  const [elapsedTime, setElapsedTime] = useState(0);
  const [isJobModalOpen, setIsJobModalOpen] = useState(false);
  const [jobModalMode, setJobModalMode] = useState<'new' | 'summary'>('new');
  const [currentJobFormData, setCurrentJobFormData] = useState({ description: '', summary: '' });
  const [endOfDaySummary, setEndOfDaySummary] = useState<WorkdaySummaryContext | null>(null);

  const [isSavingToCloud, setIsSavingToCloud] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [aiReportGenerated, setAiReportGenerated] = useState(false); // New state for AI report status
  const [syncRetryActive, setSyncRetryActive] = useState(false);
  const [jobToSummarizeId, setJobToSummarizeId] = useState<string | null>(null);

  const { toast } = useToast();

  const getCurrentFormattedDate = () => new Date().toISOString().split('T')[0];
  const getLocalStorageKey = useCallback(() => `${LOCAL_STORAGE_CURRENT_WORKDAY_KEY_PREFIX}${technicianName}`, [technicianName]);


  useEffect(() => {
    const localStorageKey = getLocalStorageKey();
    const savedWorkdayJson = localStorage.getItem(localStorageKey);
    if (savedWorkdayJson) {
      try {
        const savedWorkday = JSON.parse(savedWorkdayJson) as Workday;
        if (savedWorkday && savedWorkday.userId === technicianName && savedWorkday.status !== 'ended') {
            setWorkday(savedWorkday);
        } else {
            localStorage.removeItem(localStorageKey); // Clean up if invalid or ended
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
      let watchId: number | undefined;
  
      try {
        watchId = navigator.geolocation.watchPosition(
          (position: GeolocationPosition) => {
            const newLocation: LocationPoint = {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              timestamp: position.timestamp,
              accuracy: position.coords.accuracy ?? undefined,
            };
            setCurrentLocation(sanitizeLocationPoint(newLocation) ?? null);
            setGeolocationError(null);
          },
          (error) => {
            console.error('Geolocation error:', {
              code: error.code ?? 'N/A',
              message: error.message ?? 'Unknown error'
            });
            setGeolocationError({
              code: error.code ?? 0, // Ensure code is a number
              message: error.message ?? 'Error de geolocalización desconocido.',
            });
          },
          {
            enableHighAccuracy: true,
            timeout: 20000,
            maximumAge: 0
          }
        );
  
        // cleanup on unmount or when watchId changes
        return () => {
          if (watchId !== undefined) {
            navigator.geolocation.clearWatch(watchId);
 }
        };
      } catch (err) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
        setGeolocationError({ code: 0,
          message: 'Error iniciando seguimiento de geolocalización.'
        });
      }
    } // Closing brace for the if (typeof navigator !== 'undefined' && navigator.geolocation) block
  }, [toast]); // Include toast as a dependency
  const recordEvent = useCallback((type: TrackingEvent['type'], locationParam: LocationPoint | null | undefined, jobId?: string, details?: string) => {
    setWorkday(prev => { // Use functional update pattern to ensure latest state
      if (!prev) return null; // Return null if previous state is null
      const eventLocation = sanitizeLocationPoint(locationParam === undefined ? currentLocation : locationParam); // Sanitize the location for the event, returns LocationPoint | undefined
      const tempEventLiteral: Omit<TrackingEvent, 'workdayId' | 'isSynced'> = { // Define the literal structure first
        id: crypto.randomUUID(),
        type,
 timestamp: Date.now(), // Ensure timestamp is a number
 jobId: jobId ?? undefined, // Ensure jobId is undefined if null
        details: details ?? undefined, // Ensure details is undefined if null
        location: eventLocation, // sanitizeLocationPoint returns LocationPoint | undefined, which matches TrackingEvent type
      };
      return { ...prev, events: [...prev.events, {...tempEventLiteral, workdayId: prev.id, isSynced: false}] };
    });
  }, [currentLocation]); // Dependency array for recordEvent


  useEffect(() => {
    let intervalId: NodeJS.Timeout | undefined = undefined;

    if (workday?.status === 'tracking') {
      intervalId = setInterval(() => {
        if (!workday || !workday.startTime) return; // Add guard clauses
        const now = Date.now();
        let activeTime = now - workday.startTime;
        workday.pauseIntervals?.forEach(p => { // Use optional chaining for pauseIntervals
          if (p.endTime && p.startTime) {
            activeTime -= (p.endTime - p.startTime);
          }
        });
        setElapsedTime(activeTime < 0 ? 0 : activeTime);
      }, 1000);
    } else if ((workday?.status === 'paused' || workday?.status === 'ended') && workday?.startTime) { // Add checks for workday and startTime
        const baseTime = (workday.endTime || workday.pauseIntervals?.find(p => !p.endTime)?.startTime || Date.now()); // Use optional chaining
        let activeTime = (baseTime) - (workday.startTime || baseTime) ;
         workday.pauseIntervals?.forEach(p => { // Use optional chaining
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
    if (workday?.status === 'tracking' && currentLocation) {
      intervalId = setInterval(() => {
        const safeCurrentLocation = sanitizeLocationPoint(currentLocation); // Sanitize outside the state update, returns LocationPoint | undefined
        if (safeCurrentLocation) { // Check if sanitizeLocationPoint returned a LocationPoint (not null)
          setWorkday(prev => prev ? ({ ...prev, locationHistory: [...(prev.locationHistory || []), safeCurrentLocation] }) : null); // Add sanitized location to history
          recordEvent('LOCATION_UPDATE', safeCurrentLocation, undefined, "Actualización periódica de 1 min"); // recordEvent expects LocationPoint | null | undefined
        } // This brace closes the if (safeCurrentLocation) block
      }, 60 * 1000); // Changed to 1 minute // Closing brace for the setInterval call
 }
 // This brace closes the if (workday?.status === 'tracking' && currentLocation) block
 return () => { if (intervalId) clearInterval(intervalId); };
  }, [workday?.status, currentLocation, recordEvent]);
  useEffect(() => {
    let retryInterval: NodeJS.Timeout | undefined = undefined;

    if (syncRetryActive) {
      console.log('Sync retry active. Setting up interval.');
      retryInterval = setInterval(async () => {
        console.log('Attempting failed sync retry...');
        setSyncStatus('syncing');
        try {
          await syncLocalDataToSupabase();
          setSyncStatus('success');
          setSyncRetryActive(false);
          toast({
            title: "Sincronización Exitosa",
            description: "Datos pendientes sincronizados correctamente.",
            variant: "success",
          });
        } catch (error) {
          console.error('Failed sync retry failed:', error);
 setSyncStatus('error');
        }
      }, 60000); // Retry every 60 seconds (adjust as needed)
    }
    // Cleanup interval on component unmount or when retry becomes inactive
    return () => { if (retryInterval) clearInterval(retryInterval);
    };
 }, [syncRetryActive, toast]); // Include toast as it's used in the interval function
  if (workday?.status === 'tracking' && !currentJob) {
    if (aiLoading.newJob || isJobModalOpen) return;

    const lastMovementTime = workday.locationHistory?.[workday.locationHistory.length - 1]?.timestamp || workday.startTime;
    if (Date.now() - (lastMovementTime || Date.now()) > STOP_DETECT_DURATION_MS) {
      const hasBeenPromptedRecently = (workday.lastNewJobPromptTime || 0) > 0 && (Date.now() - (workday.lastNewJobPromptTime || 0) < RECENT_PROMPT_THRESHOLD_MS);
      setAiLoading(prev => ({ ...prev, newJob: true }));
      decidePromptForNewJob({ hasBeenPromptedRecently: !!hasBeenPromptedRecently, timeStoppedInMinutes: Math.round(STOP_DETECT_DURATION_MS / (60 * 1000)) })
        .then(res => {
          if (res.shouldPrompt) {
            // No toast here, rely on status indicators
            setJobModalMode('new' as 'new' | 'summary');
 setIsJobModalOpen(true);
 recordEvent('NEW_JOB_PROMPT', currentLocation, undefined, `IA: ${res.reason}`);
 }
 setWorkday(prev => prev ? ({...prev, lastNewJobPromptTime: Date.now()}) : null);
 })
 .catch((err: any) => { // Add catch block for AI decision errors with parameter
 toast({ title: "Error de IA", description: "No se pudo verificar si hay un nuevo trabajo.", variant: "destructive" }); }).finally(() => setAiLoading(prev => ({...prev, newJob: false}))); // Ensure AI loading is off in all cases
    } // This brace closes the stop detect duration check logic
 }, [workday, currentLocation, toast, recordEvent, currentJob, isJobModalOpen, aiLoading.newJob]);

  useEffect(() => {
    if (workday?.status === 'tracking' && currentJob && currentJob.status === 'active' && currentLocation) {
        if(aiLoading.jobCompletion || isJobModalOpen) return;

        const jobStartLocation = currentJob.startLocation; // Already sanitized LocationPoint
        if (!jobStartLocation) return; // Should not happen if job was created correctly

        const distance = haversineDistance(jobStartLocation, currentLocation); // currentLocation is sanitized
        if (distance > MOVEMENT_THRESHOLD_METERS) {
          const lastPromptTime = workday.lastJobCompletionPromptTime;
          console.log("Checking job completion prompt logic...");
          setAiLoading(prev => ({ ...prev, jobCompletion: true }));
          decidePromptForJobCompletion({ distanceMovedMeters: distance, lastJobPromptedTimestamp: lastPromptTime ?? 0 }) // Pass 0 if lastPromptTime is null/undefined
            .then(res => {
              if (res.shouldPrompt) {
                setJobModalMode('summary' as 'new' | 'summary'); // Explicitly cast
                setCurrentJobFormData({ description: currentJob.description || '', summary: '' });
                setIsJobModalOpen(true);
                recordEvent('JOB_COMPLETION_PROMPT', currentLocation, currentJob.id, `IA: ${res.reason}`); // recordEvent accepts LocationPoint | null | undefined
              }
 setWorkday(prev => prev ? ({ ...prev, lastJobCompletionPromptTime: Date.now() }) : null);
            })
 .catch(err => { // Add catch block for AI decision errors with parameter
 toast({ title: "Error de IA", description: "No se pudo verificar la finalización del trabajo. Por favor, finaliza/inicia trabajos manualmente si es necesario.", variant: "destructive" }); }).finally(() => setAiLoading(prev => ({ ...prev, jobCompletion: false }))); // Ensure finally is attached to the catch block
 } // Closing brace for the distance check logic (if block)
  }, [workday, currentJob, currentLocation, toast, recordEvent, isJobModalOpen, aiLoading.jobCompletion, isJobModalOpen, aiLoading]); // Dependency array for this useEffect


 const handleStartTracking = async () => {
    const safeCurrentLocation = sanitizeLocationPoint(currentLocation); // sanitizeLocationPoint returns LocationPoint | undefined
 if (!currentLocation) { // Check if currentLocation state is null
 toast({ title: "Esperando Ubicación", description: "Aún no se ha obtenido tu ubicación. Iniciando jornada sin coordenadas iniciales." }); // Show informative toast
 }
 setGeolocationError(null); // Clear any previous location errors on start
 setEndOfDaySummary(null); // Reset end of day summary on starting a new day
 const startTime = Date.now();
    const workdayId = crypto.randomUUID();
 const newWorkday: Workday = {
 id: workdayId,
      technicianId: technicianName, // Link workday to the technician
      userId: technicianName, // Ensure userId is also set
      date: getCurrentFormattedDate(),
      startTime: startTime,
      startLocation: safeCurrentLocation, // safeCurrentLocation is LocationPoint | undefined
      status: 'tracking',
      locationHistory: safeCurrentLocation ? [safeCurrentLocation] : [], // Initialize history with start location if available
 events: [{
 id: crypto.randomUUID(),
 type: 'SESSION_START',
 timestamp: startTime,
 location: safeCurrentLocation, // safeCurrentLocation is LocationPoint | undefined
 details: `Sesión iniciada por ${technicianName}`,
 workdayId: workdayId, // Link event to workday
 isSynced: false,
 }],
 pauseIntervals: [],
      isSynced: false, // Workday is initially unsynced
 jobs: [], // Initialize jobs array
    };

    // Save to local DB first
    try {
 await localDb.workdays.add({...newWorkday, startLocation: newWorkday.startLocation ?? null}); // Convert undefined to null for Dexie
 setWorkday(newWorkday); // Update state with the new workday object
 toast({ title: "Seguimiento Iniciado", description: "Tu jornada laboral ha comenzado." });
      // First AI prompt after starting tracking (non-blocking)
      setTimeout(() => {
        setJobModalMode('new' as 'new' | 'summary'); // Explicitly cast
        setCurrentJobFormData({ description: '', summary: '' });
        setIsJobModalOpen(true);
 // Add the recordEvent call here as planned
        recordEvent('NEW_JOB_PROMPT', safeCurrentLocation, undefined, "Prompt inicial después del inicio de sesión");
      }, 100); // Small delay to ensure state updates before prompting

 setIsSavingToCloud(false); // Reset saving state
 setSyncStatus('syncing'); // Set status to syncing before initial sync
      try { // Add the try block for the sync operation
        await syncLocalDataToSupabase(); // Trigger sync after starting workday
 setSyncStatus('success');
      } catch (error: any) { // Add the error parameter to the catch block.
 console.error("Error triggering sync after starting workday:", error); setSyncRetryActive(true); setSyncStatus('error'); // Set status to error on failure
 }
    } catch (dbError: any) { // Catch errors from local DB add operation with parameter
 console.error("Error saving new workday to local DB:", dbError);
 toast({ title: "Error Local", description: "No se pudo guardar la jornada en tu dispositivo.", variant: "destructive" } as const);
 setWorkday(null); // Revert state as local save failed
 return; // Stop execution if local save fails
 }
    setIsLoading(false); // Turn off loading state after local save and state update
 }; // Closing brace for handleStartTracking
  const handlePauseTracking = () => {
    const now = Date.now();
    const newPauseInterval: PauseInterval = { // Define the newPauseInterval object here with proper type annotation
      id: crypto.randomUUID(), // Assign a new UUID
      workdayId: workday.id,
 startTime: now, // Ensure startTime is a number
      startLocation: sanitizeLocationPoint(currentLocation), // sanitizeLocationPoint returns LocationPoint | undefined
      isSynced: false, // Mark the new pause interval as unsynced
    };
    setWorkday(prev => { // Use functional update pattern to ensure latest state
      if (!prev) return null; // Return null if previous state is null
 return {
 ...prev, // Spread previous state
      status: 'paused',
      // Add the new pause interval to the array
      pauseIntervals: [...prev.pauseIntervals, newPauseInterval],
      };
 });

 recordEvent('SESSION_PAUSE', currentLocation); // recordEvent expects LocationPoint | null | undefined, currentLocation is LocationPoint | null
    setIsLoading(true);
 toast({ title: "Seguimiento Pausado", description: "Tu jornada laboral está en pausa." });
    // Start sync after UI updates and event recording
    setSyncStatus('syncing'); // Set status to syncing before sync
 syncLocalDataToSupabase()
 .then(() => { setSyncStatus('success');}) // Set status to success on successful sync
 .catch((error: any) => { // Add the error parameter to the catch block.
 console.error("Error triggering sync after pausing:", error); // Log the actual error // Closing brace for the catch block
        setSyncRetryActive(true); // Activate retry if initial sync fails
 setSyncStatus('error'); // Set status to error on failure
 });
  const handleResumeTracking = () => {
    if (!workday) return;
    setIsLoading(true);
    const now = Date.now();
    setWorkday(prev => { // Use functional update to get the latest state
      if (!prev) return null;
      const updatedPauses = [...(prev.pauseIntervals || [])]; // Ensure pauses is an array, handle potential null
      // Find the last active pause interval and update its end time and location using strict non-null check
      const lastActivePauseIndex = updatedPauses.findIndex(p => p.startTime && !p.endTime);
      if (lastActivePauseIndex > -1) {
        const currentPause = updatedPauses[lastActivePauseIndex]; // Get the specific pause interval
        currentPause.endTime = now;
        currentPause.endLocation = sanitizeLocationPoint(currentLocation); // sanitizeLocationPoint returns LocationPoint | undefined
        currentPause.isSynced = false; // Mark the updated pause as unsynced
      }
      return {
        ...prev,
        status: 'tracking',
        pauseIntervals: updatedPauses, // Ensure updatedPauses is returned
      };
    }); // Close the setWorkday functional update
 recordEvent('SESSION_RESUME', currentLocation); // recordEvent accepts LocationPoint | null | undefined, currentLocation is LocationPoint | null
 toast({ title: "Seguimiento Reanudado", description: "¡Bienvenido de nuevo! El seguimiento está activo." });
    setIsLoading(false);
    setSyncStatus('syncing');
 syncLocalDataToSupabase().then(() => { setSyncStatus('success'); })
      .catch((error: any) => {
        console.error("Error triggering sync after resuming:", error); setSyncRetryActive(true); setSyncStatus('error');
      }); // Closing brace for the catch block
 };
 const handleJobFormSubmit = async (jobToSummarizeId: string | null, isEndingDaySubmit: boolean = false) => {
 if (!workday) {
 // Corrected line 282: Fixed potential syntax issue if the return was missing a semicolon
 return;
 }
 const safeCurrentLocation = sanitizeLocationPoint(currentLocation);
      // --- Logic for Starting a New Job ---
      setIsSavingToCloud(true);
      if (!safeCurrentLocation) {
        toast({ title: "Ubicación Requerida", description: "No se puede iniciar un nuevo trabajo sin una ubicación válida.", variant: "destructive" });
 setIsSavingToCloud(false); // Ensure saving state is turned off if location is missing
 return;
      }
      const newJob: Job = { // Define the newJob object here with proper type annotation
        id: crypto.randomUUID(), // Assign a new UUID
        description: currentJobFormData.description,
        startTime: Date.now(), // Ensure startTime is a number
 workdayId: workday.id, // Link to the current workday
        startLocation: safeCurrentLocation, // sanitizeLocationPoint returns LocationPoint | undefined
        status: 'active' as 'active' | 'completed', // Explicitly cast to literal type
        isSynced: false,
      };
      setWorkday(prev => prev ? { // Use functional update to get the latest state
 ...prev, // Spread previous state
 jobs: [...prev.jobs, newJob],
        currentJobId: newJob.id, // Ensure id is treated as string | null
 } : null); // If prev is null, return null
      recordEvent('JOB_START', safeCurrentLocation, newJob.id, `Nuevo trabajo iniciado: ${newJob.description}`); // Record job start event
      toast({ title: "Nuevo Trabajo Iniciado", description: `Trabajo: "${currentJobFormData.description}"` });

      setIsJobModalOpen(false);
      setSyncStatus('syncing'); // Set status to syncing before sync
      try {
        await syncLocalDataToSupabase(); // Trigger sync after starting a new job
        setSyncStatus('success'); // Set status to success on successful sync
      } catch (error: any) { // Add the error parameter to the catch block.
        console.error("Error triggering sync after starting new job:", error); // Log the actual error in catch block
 setSyncStatus('error'); // Set status to error on failure
        setSyncRetryActive(true);
        setIsSavingToCloud(false); // Ensure saving state is off on sync failure
      }
      setIsSavingToCloud(true);
      console.log("Handling job completion form submit for job ID:", jobToSummarizeId);
      const jobToUpdateIndex = workday.jobs.findIndex(j => j.id === jobToSummarizeId); // Find the index of the job to update
      if (jobToUpdateIndex === -1) {
 toast({ title: "Error Interno", description: "No se encontró el trabajo para completar.", variant: "destructive" }); // Ensure variant is literal type
 setSyncRetryActive(true); // Activate retry if the job is not found locally
        setSyncStatus('error');
        setCurrentJobFormData({ description: '', summary: '' });
 setJobToSummarizeId(null); // Reset job ID if job is not found
        setIsSavingToCloud(false); // Ensure saving state is off on error
        return; // Return early if the job is not found
      }
      console.log('Workday before update:', workday);
      const jobBeforeCompletion = workday.jobs[jobToUpdateIndex];
      // 1. Immediately update local state to mark job as completed with user summary
      setWorkday(prev => {
        if (!prev) return null;
        const updatedJobs = [...prev.jobs]; // Create a copy to avoid direct state modification
        updatedJobs[jobToUpdateIndex] = { // Update the specific job object in the array copy using the correct index
          ...jobBeforeCompletion, // Use data before AI call
          summary: currentJobFormData.summary, // Ensure user summary is saved as string
          status: 'completed', // Set status to completed explicitly
 endTime: Date.now(), // Ensure endTime is a number
 endLocation: safeCurrentLocation, // Ensure endLocation is undefined if geolocation is not available or sanitize returned undefined
          isSynced: false, // Mark the updated job as unsynced
        };

        console.log('Updated jobs before setting state:', updatedJobs); // Log the state before setting
        return {
          ...prev,
          jobs: updatedJobs,
          currentJobId: null, // No current job after completion, explicitly set to null
        };
      });

      // Record the job completion event immediately after local update
 recordEvent('JOB_COMPLETED', safeCurrentLocation, jobBeforeCompletion.id, `Trabajo completado. Usuario: ${currentJobFormData.summary}`);
      toast({ title: "Trabajo Completado", description: `Resumen de usuario guardado para el trabajo.` }); // Show toast for user summary saved
      setJobToSummarizeId(null);
      // Close modal and reset form immediately (moved this outside the try/catch for sync)
      setIsJobModalOpen(false);
      try {
        setSyncStatus('syncing'); // Set status to syncing before sync
 // Await the sync operation to ensure local state is saved before potentially ending the day
        await syncLocalDataToSupabase(); // Trigger sync after completing a job (user summary saved)
        setSyncStatus('success'); // Set status to success on successful sync
      } catch (error: any) {
        console.error("Error triggering sync after completing job:", error);
        setSyncStatus('error'); // Set status to error
 setSyncRetryActive(true); // Keep existing retry activation
      } finally {
        setIsSavingToCloud(false);
        setCurrentJobFormData({ description: '', summary: '' }); // Reset form data

        // 2. Initiate AI summarization asynchronously (fire-and-forget)
        setAiLoading(prev => ({ ...prev, summarize: true })); // Indicate AI is working by setting state
        // Use the job description and user's summary for the AI prompt
 summarizeJobDescription({ jobDescription: jobBeforeCompletion.description || 'N/A', userSummary: currentJobFormData.summary || 'N/A' }) // Provide default if summary is empty, include user summary
          .then(async aiRes => { // Use async in the then block to await inner promises
            console.log('AI Summarization result:', aiRes);
            console.log("AI Summarization successful:", aiRes.summary);
            // Update local state with AI summary opportunistically
            // We can update the state directly here since it's non-blocking and we don't need to await it.
            // The sync after this will capture the AI summary if it's fast enough.
 setWorkday(prev => prev ? ({ ...prev,
 jobs: prev.jobs.map(job => job.id === jobToSummarizeId ? { ...job, aiSummary: aiRes.summary, isSynced: false } : job) // Update the specific job with AI summary and mark as unsynced
              }) : null);
            setAiReportGenerated(true); // Set AI report status to true
 toast({ title: "Resumen IA", description: "Resumen automático del trabajo añadido." });
 setSyncStatus('syncing'); // Set status to syncing before sync for the AI summary
            // Trigger sync after AI summary is added to state (non-blocking)
            await syncLocalDataToSupabase(); // Trigger sync after AI summary update
 setSyncStatus('success'); // Set status to success on successful sync after AI summary
          })
          .catch(err => { // Add catch block for AI summarization errors with parameter
            console.error("AI Summarization failed:", err);setSyncStatus('error'); // Set status to error if AI fails
          }) // Closing brace for AI summarization catch block
 .finally(() => { // Finally block after AI attempt
            setWorkday(latestWorkdayState => {
              // Only initiate end day process if this submit was triggered by the End Day action AND the job is completed locally
 if (isEndingDaySubmit && latestWorkdayState) { // Check if isEndingDaySubmit is true and latestWorkdayState is not null
                // Ensure the job is actually completed locally before initiating the end day process
                const jobIsLocallyCompleted = latestWorkdayState.jobs.find(j => j.id === jobToSummarizeId)?.status === 'completed';
                if (jobIsLocallyCompleted) {
 initiateEndDayProcess(latestWorkdayState, toast, setIsLoading, setWorkday, setEndOfDaySummary, setSyncStatus, setSyncRetryActive);
                }
              }
              return latestWorkdayState; // Always return the latest state
            });
 // This finally block runs whether AI succeeds or fails.
            setAiLoading(prev => ({ ...prev, summarize: false })); // Ensure AI loading is off
 });
 }; // Closing brace for the handleJobFormSubmit function
 const handleEndDay = async () => {
 if (!workday) return; // Cannot end day if no workday exists
    const activeJob = workday.jobs.find(j => j.id === workday.currentJobId && j.status === 'active'); // Find the active job

 if (activeJob) { // If there is an active job, open the summary modal for that job first
      setJobModalMode('summary' as 'new' | 'summary'); // Explicitly cast
      setCurrentJobFormData({ description: activeJob.description || '', summary: '' });
      setIsJobModalOpen(true);
      recordEvent('JOB_COMPLETION_PROMPT', currentLocation, activeJob.id, "Prompt al finalizar el día");
 return; // Stop here, the process will continue after the job form submit
    }

    // If no active job, proceed directly to initiating the end day process
    // Call initiateEndDayProcess with the current state of the workday.
    // This is safe because initiateEndDayProcess will make a shallow copy, but for state updates it's better to use functional updates.
    // The state updates (like setting status to 'ended') will happen inside initiateEndDayProcess.
    if (!workday) {
 console.error("Workday became null unexpectedly before initiateEndDayProcess could be called.");
 toast({ title: "Error Interno", description: "Estado de jornada perdido al intentar finalizar.", variant: "destructive" }); // Ensure variant is literal
    }
    initiateEndDayProcess(workday, toast, setIsLoading, setWorkday, setEndOfDaySummary, setSyncStatus, setSyncRetryActive);
 }; // Corrected line 404: Added closing brace for the handleEndDay function

  const handleManualCompleteJob = () => {
    // Only proceed if there is an active job
    if (currentJob) {
      setJobToSummarizeId(currentJob.id); // Ensure jobToSummarizeId is set to the active job's ID
      setJobModalMode('summary' as 'new' | 'summary'); // Explicitly cast
      setCurrentJobFormData({ description: currentJob.description || '', summary: '' }); // Ensure description is string
      setIsJobModalOpen(true);
      recordEvent('USER_ACTION', currentLocation, currentJob.id, "Modal de completar trabajo abierto manualmente");
    } else {
      toast({
        title: "Error",
        description: "No hay un trabajo activo para completar manualmente.",
 variant: "destructive",
      });
    }
  };

  const handleManualStartNewJob = () => {
    const safeCurrentLocation = sanitizeLocationPoint(currentLocation);
    if (!safeCurrentLocation) {
      toast({ title: "Ubicación Requerida", description: "No se puede iniciar un nuevo trabajo sin una ubicación válida.", variant: "destructive" });
 return;
    }
    setJobModalMode('new' as 'new' | 'summary'); // Explicitly cast to literal type
    setCurrentJobFormData({ description: '', summary: '' }); // Set initial form data
    setIsJobModalOpen(true); // Open the modal
    setJobToSummarizeId(null);
    recordEvent('USER_ACTION', safeCurrentLocation, undefined, "Modal de nuevo trabajo abierto manualmente"); // Record the event
  };

  const ActionButton = () => {
    const commonDisabled = isLoading || isSavingToCloud || aiLoading.newJob || aiLoading.jobCompletion || aiLoading.summarize; // Disable buttons while loading, saving, or AI is active

    if (!workday || workday.status === 'idle') {
      // Render start button if no workday exists or workday status is idle
 return (
 <Button
 onClick={() => handleStartTracking()}
 disabled={commonDisabled} // <- quitamos "|| !currentLocation"
 variant="default" // Primary button for starting
 className="w-full"
 size="lg"
 >
 {commonDisabled ? (
 <Loader2 className="mr-2 h-4 w-4 animate-spin" />
 ) : (
 <Play className="mr-2 h-4 w-4" /> // Play icon for starting
 )}
          Iniciar Seguimiento
        </Button> // Closing tag for the Button component
 );
    }

    switch (workday?.status) {
      case 'tracking':
        return (
          <div className="flex space-x-2 w-full"> {/* Use a div for spacing */}
 <Button onClick={handlePauseTracking} disabled={commonDisabled} variant="secondary" className="flex-1"> {/* Corrected closing tag */}
 {commonDisabled ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pause className="mr-2 h-4 w-4" />} Pausar {/* Ensure text is inside the Button */}
            </Button>
            <Button onClick={handleEndDay} disabled={commonDisabled || (currentJob && aiLoading.summarize) } variant="destructive" className="flex-1"> {/* Disable End Day if AI is summarizing an active job */}
              {commonDisabled ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <StopCircle className="mr-2 h-4 w-4" />}
              Finalizar Día
            </Button>
          </div>
        );

      case 'paused':
        return (
          <div className="flex space-x-2 w-full"> {/* Use a div for spacing */}
            <Button onClick={handleResumeTracking} disabled={commonDisabled} variant="default" className="flex-1">{commonDisabled ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />} Reanudar {/* Ensure text is inside the Button */}</Button>

 {/* Add a spacer or another button here if needed */ }
            <Button onClick={handleEndDay} disabled={commonDisabled} variant="destructive" className="flex-1">
              {commonDisabled ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <StopCircle className="mr-2 h-4 w-4" />}
              Finalizar Día
            </Button>
          </div>
        );
      case 'ended':
        return (
          <Button
            onClick={() => {
 // Reset state for a new day
                  setWorkday(null);
                  setElapsedTime(0);
                  setEndOfDaySummary(null);
 localStorage.removeItem(getLocalStorageKey());
 toast({ title: "Día Finalizado", description: "Puedes comenzar un nuevo día de seguimiento." });
                }}
            disabled={commonDisabled}
            variant="default" // Primary button for starting a new day
            className="w-full" // Make the button full width
            size="lg"
          >
            {commonDisabled ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />} {/* Use Play icon for starting new day */}
            Iniciar Nuevo Día {/* Ensure text is inside the Button */}
 </Button>
        );
    }

 return null;
  };


  return (
    <>
      <Card className="w-full max-w-md shadow-xl mx-auto my-8">
 {/* CardHeader and following sections are now correctly nested inside Card */}
          <CardHeader>
            <CardTitle className="flex items-center space-x-2"> {/* Added closing tag for CardTitle */}
              <User className="h-6 w-6" />
              <span>{technicianName}</span> {/* Ensure technicianName is used here */}
            </CardTitle>
            <CardDescription>
              Sistema de Seguimiento Técnico
            </CardDescription>
          </CardHeader>
          {/* Unified CardContent */}
          <CardContent className="flex flex-col space-y-4">
 {/* Location and Time Info (Hide after day ends) */}
            {workday?.status !== 'ended' && (
              <> {/* Use fragment for grouping */}
                <LocationInfo
                  location={currentLocation}
                  error={geolocationError || undefined}
                  label="Ubicación Actual"
                  getGoogleMapsLink={(loc: LocationPoint) => `https://www.google.com/maps/search/?api=1&query=${loc.latitude},${loc.longitude}`}
                />
                {geolocationError && (
                  <div className="text-sm text-red-600 flex items-start space-x-2">
                    <Ban className="h-5 w-5 flex-shrink-0" />
                    <span><strong>Geolocalización Deshabilitada:</strong> Para iniciar el seguimiento, la aplicación necesita acceder a tu ubicación. Por favor, habilita los permisos de ubicación para esta app en la configuración de tu dispositivo.</span>
                  </div>
                )}
                {workday?.status !== 'idle' && (
                  <> {/* Use fragment for grouping */}
                    <div className="flex items-center space-x-2 text-sm"><Clock className="h-5 w-5 text-blue-500" /><span>Tiempo Transcurrido: {formatTime(elapsedTime)}</span></div>
                    {currentJob ? (
                      <div className="flex items-center space-x-2 text-sm">
                        <Briefcase className="h-5 w-5 text-green-500" />
                        <span>Trabajo Actual: {currentJob.description}</span>
                      </div>
                    ) : null}
                  </>
                )}
              </>
 )}
 {/* Current Status Display (Show unless day ended) */}
            {workday && workday.status !== 'ended' && (
              <CurrentStatusDisplay
                workday={workday}
                endOfDaySummary={endOfDaySummary}
              />
            )}
            {/* Status Indicators */}
 <div className="flex items-center space-x-4 text-sm mt-4 flex-wrap">
 {/* Geolocation Status */}
              <div className="flex items-center space-x-1 min-w-[180px]">
                {geolocationError ? (
 <div className="flex items-center text-red-500 space-x-1">
                    <Ban className="h-4 w-4 text-red-500" />
 <span>Ubicación: Inactiva</span>
                  </div>
 ) : workday?.status !== 'ended' && currentLocation ? (
 <div className="flex items-center text-green-500 space-x-1">
                    <MapPinned className="h-4 w-4 text-green-500" /> <span>Ubicación: Activa</span>
 </div>
              ) : workday?.status !== 'ended' && !currentLocation ? (
                <div className="flex items-center space-x-1">
                  <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />
                  <span>Ubicación: Esperando...</span>
                </div>
 ) : null}{' '}
              </div>
            {/* Cloud Sync Status */}
            <div className="flex items-center space-x-1 min-w-[150px]">
                {syncStatus === 'syncing' && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
 {syncStatus === 'success' && <CloudUpload className="h-4 w-4 text-green-500" />}
                {syncStatus === 'error' && <AlertTriangle className="h-4 w-4 text-red-500" />} {/* Using AlertTriangle for error */}
                {(syncStatus === 'idle' || (workday?.status !== 'ended' && !isSavingToCloud)) && <CloudUpload className="h-4 w-4 text-gray-500" />} {/* Show idle unless day ended or saving */}
 <span>Nube: {syncStatus === 'syncing' ? 'Sincronizando...' : syncStatus === 'success' ? 'Sincronizada' : syncStatus === 'error' ? 'Error' : workday?.status === 'ended' ? 'Finalizada' : 'Inactiva'}</span>
 </div>
              {/* Job Status */}
              <div className="flex items-center space-x-1">
                <span>Trabajo: </span>
                {currentJob ? ( // Check if currentJob exists
 <> {/* Using Play for active job */}
 <Play className="h-4 w-4 text-green-500" /> Sí{' '}
                  </>
                ) : (
                  <>
 {/* Using Briefcase for no active job (you might consider AlertTriangle if it indicates an expected next step) */}
 {/* Blueprint suggests exclamation, but Play/Briefcase align better with start/no start. Let's stick to Play/Briefcase for clarity */}
 <Briefcase className="h-4 w-4 text-gray-500" /> No
                  </>
                )}
              </div>
            </div>

          </CardContent>
 {/* CardFooter for buttons and persistent indicators */}
          <CardFooter className="flex-col space-y-4">
            <ActionButton />

            {/* Job Management Buttons (Show only when tracking and not loading/saving) */}
            {workday?.status === 'tracking' && !currentJob && !isLoading && !isSavingToCloud && ( // Corrected the condition to apply to the entire block
              <div className="flex space-x-2 w-full"> {/* Use a div for spacing */}
                <Button onClick={handleManualStartNewJob} variant="secondary" size="sm" className="flex-1">
                  <Briefcase className="mr-1 h-4 w-4" /> Nuevo Trabajo
                </Button>
                {currentJob && (
                  <Button onClick={handleManualCompleteJob} variant="secondary" size="sm" className="flex-1">
                    <CheckCircle className="mr-1 h-4 w-4" /> Completar Trabajo
                  </Button>
                )}
              </div>
            )}

            {(aiLoading.newJob || aiLoading.jobCompletion || aiLoading.summarize) && (
              <div className="flex items-center space-x-2 text-sm text-purple-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>
                  {aiLoading.newJob && 'IA pensando (nuevo trabajo)...'}
                  {aiLoading.jobCompletion && 'IA pensando (finalizar trabajo)...'}
                  {aiLoading.summarize && 'IA resumiendo trabajo...'}
                </span>
              </div>
            )}
            {/* Link to History */}
            <Link href="/history" passHref legacyBehavior>
              <Button variant="ghost" className="w-full">
                <History className="mr-2 h-4 w-4" /> Ver Historial
              </Button>
            </Link>
          </CardFooter>
        </Card>

        {/* Job Modal (New Job or Summarize Job) */}
        <Dialog open={isJobModalOpen} onOpenChange={setIsJobModalOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{jobModalMode === 'new' ? 'Nuevo Trabajo' : 'Resumir Trabajo'}</DialogTitle>
              <DialogDescription>
                {jobModalMode === 'new' ? 'Describe el nuevo trabajo que vas a comenzar.' : 'Describe el trabajo completado o añade un resumen.'}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid w-full max-w-sm items-center gap-1.5">
                <Label htmlFor="job-description">Descripción del Trabajo</Label>
                <Textarea
                  id="job-description"
                  placeholder={jobModalMode === 'new' ? 'Mantenimiento preventivo en cliente XYZ...' : 'Se realizó limpieza y ajuste de componentes.'}
                  value={currentJobFormData.description}
                  onChange={(e) => setCurrentJobFormData({ ...currentJobFormData, description: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary">Cancelar</Button>
              </DialogClose>
              <Button type="submit" onClick={() => handleJobFormSubmit(jobToSummarizeId)}>{jobModalMode === 'new' ? 'Iniciar Trabajo' : 'Guardar Resumen'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </>
  );
