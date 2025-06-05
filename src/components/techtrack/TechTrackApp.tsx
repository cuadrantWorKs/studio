/* force typecheck */
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

import Link from "next/link";

import { Button } from "@/components/ui/button";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";

import { Textarea } from "@/components/ui/textarea";
 
import WorkdaySummaryDisplay from "./WorkdaySummaryDisplay"; // Importing WorkdaySummaryDisplay
// Import the function from your workday library
import {
  // Import the function from your workday library
  syncLocalDataToSupabase,
  initiateEndDayProcess,
} from "@/lib/techtrack/workday";
import {
  Play,
  Pause,
  StopCircle,
  Briefcase,
  Clock,
  CheckCircle,
  AlertTriangle,
  Loader2,
  History,
  CloudUpload,
  User,
  Ban,
  MapPinned,
} from "lucide-react";

import { haversineDistance } from "@/lib/techtrack/geometry";
import { summarizeJobDescription } from "@/ai/flows/summarize-job-description";
import { db as localDb } from "@/db";
import { decidePromptForNewJob } from "@/ai/flows/decide-prompt-for-new-job";
import { decidePromptForJobCompletion } from "@/ai/flows/decide-prompt-for-job-completion";
import CurrentStatusDisplay from "./CurrentStatusDisplay"; // Import the new component

import { Label } from "@/components/ui/label"; // Import the Label component from your UI library
import { formatTime } from "@/lib/utils";
import LocationInfo from "./LocationInfo";
import type {
  LocationPoint,
  Job,
  TrackingEvent,
  Workday,
  PauseInterval,  
  GeolocationError,
  WorkdaySummaryContext,
  TrackingEventType,
} from "@/lib/techtrack/types";
import { useToast } from "@/hooks/use-toast";

const STOP_DETECT_DURATION_MS = 15 * 60 * 1000;
const MOVEMENT_THRESHOLD_METERS = 100;
const RECENT_PROMPT_THRESHOLD_MS = 30 * 60 * 1000;
const LOCAL_STORAGE_CURRENT_WORKDAY_KEY_PREFIX = "TECHTRACK_CURRENT_WORKDAY_";
interface TechTrackAppProps {
  technicianName: string;
}
// Placeholder for CurrentStatusDisplay
// Helper function to sanitize location point data - Ensures numeric types are valid numbers
/**
 * Devuelve un LocationPoint válido si latitude, longitude y timestamp
 * son números no-NaN. En caso contrario, devuelve undefined.
 */
export const sanitizeLocationPoint = (
  location?: LocationPoint | null | undefined,
): LocationPoint | undefined => {
  if (location && typeof location.latitude === "number" && !isNaN(location.latitude) &&
    typeof location.longitude === "number" && !isNaN(location.longitude) &&
    typeof location.timestamp === "number" && !isNaN(location.timestamp)) {
    const sanitized: LocationPoint = {
      latitude: location.latitude,

      longitude: location.longitude,
      timestamp: location.timestamp,
    };
    if (typeof location.accuracy === "number" && !isNaN(location.accuracy)) {
      sanitized.accuracy = location.accuracy;
    }
    return sanitized;
  }
};
export default function TechTrackApp({ technicianName }: TechTrackAppProps): JSX.Element | null {
  const [currentLocation, setCurrentLocation] = useState<LocationPoint | null>(null);    const [geolocationError, setGeolocationError] = useState<GeolocationError | null>(null); // Keep this for user feedback

    const [elapsedTime, setElapsedTime] = useState(0);
    const [isJobModalOpen, setIsJobModalOpen] = useState(false);
    const [jobModalMode, setJobModalMode] = useState<"new" | "summary">("new");
    const [currentJobFormData, setCurrentJobFormData] = useState({
      description: "",
      summary: "",
    });
    const [endOfDaySummary, setEndOfDaySummary] =
      useState<WorkdaySummaryContext | null>(null);

    const [isSavingToCloud, setIsSavingToCloud] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});
    const [syncStatus, setSyncStatus] = useState<
      "idle" | "syncing" | "success" | "error"
    >("idle");
    const [aiReportGenerated, setAiReportGenerated] = useState(false); // New state for AI report status
    const [syncRetryActive, setSyncRetryActive] = useState(false);
    const [jobToSummarizeId, setJobToSummarizeId] = useState<string | null>(
      null,
    );

    const { toast } = useToast();

    const getCurrentFormattedDate = () =>
      new Date().toISOString().split("T")[0];
    const [workday, setWorkday] = useState<Workday | null>(null);
    const getLocalStorageKey = useCallback(
      () => `${LOCAL_STORAGE_CURRENT_WORKDAY_KEY_PREFIX}${technicianName}`,
      [technicianName],
    );

    useEffect(() => {
      const localStorageKey = getLocalStorageKey();
      const savedWorkdayJson = localStorage.getItem(localStorageKey);
      if (savedWorkdayJson) {
        try {
          const savedWorkday = JSON.parse(savedWorkdayJson) as Workday;
          if (
            savedWorkday &&
            savedWorkday.userId === technicianName &&
            savedWorkday.status !== "ended"
          ) {
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
      if (
        workday &&
        workday.status !== "ended" &&
        workday.userId === technicianName
      ) {
        localStorage.setItem(localStorageKey, JSON.stringify(workday));
      }
    }, [workday, technicianName, getLocalStorageKey]);

    const currentJob = useMemo(() => {
      if (!workday?.currentJobId) return null;
      return workday.jobs.find((j) => j.id === workday.currentJobId) ?? null;
    }, [workday]);

    useEffect(() => {
      if (typeof navigator !== "undefined" && navigator.geolocation) {
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
              console.error("Geolocation error:", {
                code: error.code ?? "N/A",
                message: error.message ?? "Unknown error",
              });
              setGeolocationError({
                code: error.code ?? 0, // Ensure code is a number
                message:
                  error.message ?? "Error de geolocalización desconocido.",
              });
            },
            {
              enableHighAccuracy: true,
              timeout: 20000,
              maximumAge: 0,
            },
          );

          // cleanup on unmount or when watchId changes
          return () => {
            if (watchId !== undefined) {
              navigator.geolocation.clearWatch(watchId);
            }
          };
        } catch (err) {
           
          setGeolocationError({
            code: 0,
            message: "Error iniciando seguimiento de geolocalización.",
          });
        }
      } // Closing brace for the if (typeof navigator !== 'undefined' && navigator.geolocation) block
    }, [toast]); // Include toast as a dependency
    const recordEvent = useCallback(
      (
        type: TrackingEvent["type"],
        locationParam: LocationPoint | null | undefined,
        jobId?: string,
        details?: string,
      ) => {
        setWorkday((prev) => {
          // Use functional update pattern to ensure latest state
          if (!prev) return null as Workday | null; // Return null if previous state is null
          const eventLocation = sanitizeLocationPoint(
            locationParam === undefined ? currentLocation : locationParam,
          ); // Sanitize the location for the event, returns LocationPoint | undefined
          const tempEventLiteral: Omit<
            TrackingEvent,
            "workdayId" | "isSynced"
          > = {
            // Define the literal structure first
            id: crypto.randomUUID(),
            type,
            timestamp: Date.now(), // Ensure timestamp is a number
            jobId: jobId ?? undefined, // Ensure jobId is undefined if null
            details: details ?? undefined, // Ensure details is undefined if null
            location: eventLocation, // sanitizeLocationPoint returns LocationPoint | undefined, which matches TrackingEvent type
          };
          return {
            ...prev,
            events: [
              ...prev.events,
              { ...tempEventLiteral, workdayId: prev.id, isSynced: false },
            ],
          };
        });
      },
      [currentLocation],
    ); // Dependency array for recordEvent

    useEffect(() => {
      let intervalId: NodeJS.Timeout | undefined = undefined;

      if (workday?.status === "tracking") {
        intervalId = setInterval(() => {
          if (!workday || !workday.startTime) return; // Add guard clauses
          const now = Date.now();
          let activeTime = now - workday.startTime;
          workday.pauseIntervals?.forEach((p) => {
            // Use optional chaining for pauseIntervals
            if (p.endTime && p.startTime) {
              activeTime -= p.endTime - p.startTime;
            }
          });
          setElapsedTime(activeTime < 0 ? 0 : activeTime);
        }, 1000);
      } else if (
        (workday?.status === "paused" || workday?.status === "ended") &&
        workday?.startTime
      ) {
        // Add checks for workday and startTime
        const baseTime =
          workday.endTime ||
          workday.pauseIntervals?.find((p) => !p.endTime)?.startTime ||
          Date.now(); // Use optional chaining
        let activeTime = baseTime - (workday.startTime || baseTime);
        workday.pauseIntervals?.forEach((p) => {
          // Use optional chaining
          if (p.endTime && p.startTime) {
            if (
              !(
                workday.status === "paused" &&
                p.startTime ===
                  workday.pauseIntervals[workday.pauseIntervals.length - 1]
                    ?.startTime &&
                !p.endTime
              )
            ) {
              activeTime -= p.endTime - p.startTime;
            }
          }
        });
        setElapsedTime(activeTime < 0 ? 0 : activeTime);
      } else if (workday?.status === "idle") {
        setElapsedTime(0);
      }

      return () => {
        if (intervalId) clearInterval(intervalId);
      };
    }, [workday]); // Dependency array for intervalId useEffect

    useEffect(() => {
      let intervalId: NodeJS.Timeout;
      if (workday?.status === "tracking" && currentLocation) {
        intervalId = setInterval(() => {
          const safeCurrentLocation = sanitizeLocationPoint(currentLocation); // Sanitize outside the state update, returns LocationPoint | undefined
          if (safeCurrentLocation) {
            // Check if sanitizeLocationPoint returned a LocationPoint (not null)
            setWorkday((prev) =>
              prev
                ? {
                    ...prev,
                    locationHistory: [
                      ...(prev.locationHistory || []),
                      safeCurrentLocation,
                    ],
                  }
                : null,
            ); // Add sanitized location to history
            recordEvent(
              "LOCATION_UPDATE",
              safeCurrentLocation,
              undefined,
              "Actualización periódica de 1 min",
            ); // recordEvent expects LocationPoint | null | undefined
          } // This brace closes the if (safeCurrentLocation) block
        }, 60 * 1000); // Changed to 1 minute
      }
      // This brace closes the if (workday?.status === 'tracking' && currentLocation) block
      return () => {
        if (intervalId) clearInterval(intervalId);
      };
    }, [workday?.status, currentLocation, recordEvent]);
    useEffect(() => {
      let retryInterval: NodeJS.Timeout | undefined = undefined;

      if (syncRetryActive) {
        console.log("Sync retry active. Setting up interval.");
        retryInterval = setInterval(async () => {
          console.log("Attempting failed sync retry...");
          setSyncStatus("syncing");
          try {
            await syncLocalDataToSupabase();
            setSyncStatus("success");
            setSyncRetryActive(false);
            toast({
              title: "Sincronización Exitosa",

              description: "Datos pendientes sincronizados correctamente.",
              variant: "default",
            });
          } catch (error) {
            console.error("Failed sync retry failed:", error);
            setSyncStatus("error");
          }
        }, 60000); // Retry every 60 seconds (adjust as needed)
      }
      // Cleanup interval on component unmount or when retry becomes inactive
      return () => {
        if (retryInterval) clearInterval(retryInterval);
      };
    }, [syncRetryActive, toast]); // Include toast as it's used in the interval function
    // Move useEffect outside of the conditional if
    useEffect(() => {
      // Place the conditional logic inside the useEffect callback
      if (workday?.status === "tracking" && !currentJob) {
        if (aiLoading.newJob || isJobModalOpen) return;

        const lastMovementTime =
          workday.locationHistory?.[workday.locationHistory.length - 1]?.timestamp || workday.startTime;
        if (
          Date.now() - (lastMovementTime || Date.now()) > STOP_DETECT_DURATION_MS
        ) {
          const hasBeenPromptedRecently =
            (workday.lastNewJobPromptTime || 0) > 0 &&
            Date.now() - (workday.lastNewJobPromptTime || 0) <RECENT_PROMPT_THRESHOLD_MS;
          setAiLoading((prev) => ({ ...prev, newJob: true }));
          decidePromptForNewJob({
            hasBeenPromptedRecently: !!hasBeenPromptedRecently,
            timeStoppedInMinutes: Math.round(STOP_DETECT_DURATION_MS / (60 * 1000)),
          })
            .then((res) => {
              if (res.shouldPrompt) {
                setJobModalMode("new" as "new" | "summary");
                setIsJobModalOpen(true);
                recordEvent("NEW_JOB_PROMPT", currentLocation, undefined, `IA: ${res.reason}`);
              }
              setWorkday((prev) => prev ? { ...prev, lastNewJobPromptTime: Date.now() } : null);
            })
            .catch((err: any) => {
              toast({ title: "Error de IA", description: "No se pudo verificar si hay un nuevo trabajo.", variant: "destructive" });
            })
            .finally(() => setAiLoading((prev) => ({ ...prev, newJob: false }))); // Ensure AI loading is off in all cases
        }
      }
    }, [
      workday,
      currentLocation,
      toast,
      recordEvent,
      currentJob,
      isJobModalOpen,
      aiLoading.newJob,
    ]);


    useEffect(() => {
      if (
        workday?.status === "tracking" &&
        currentJob &&
        currentJob.status === "active" &&
        currentLocation
      ) {
        if (aiLoading.jobCompletion || isJobModalOpen) return;

        const jobStartLocation = currentJob.startLocation; // Access startLocation directly from currentJob
        if (!jobStartLocation) return; // Should not happen if job was created correctly

        const distance = haversineDistance(jobStartLocation, currentLocation); // currentLocation is sanitized
        if (distance > MOVEMENT_THRESHOLD_METERS) {
          const lastPromptTime = workday.lastJobCompletionPromptTime;
          console.log("Checking job completion prompt logic...");
          setAiLoading((prev) => ({ ...prev, jobCompletion: true }));
          decidePromptForJobCompletion({
            distanceMovedMeters: distance,
            lastJobPromptedTimestamp: lastPromptTime ?? 0,
          }) // Pass 0 if lastPromptTime is null/undefined
            .then((res) => {
              if (res.shouldPrompt) {
                setJobModalMode("summary" as "new" | "summary"); // Explicitly cast
                setCurrentJobFormData({
                  description: currentJob.description || "",
                  summary: "",
                });
                setIsJobModalOpen(true);
                recordEvent(
                  "JOB_COMPLETION_PROMPT",
                  currentLocation,
                  currentJob.id,
                  `IA: ${res.reason}`,
                ); // recordEvent accepts LocationPoint | null | undefined
              }
              setWorkday((prev) =>
                prev
                  ? { ...prev, lastJobCompletionPromptTime: Date.now() }
                  : null,
              );
            })
            .catch((err) => {
              // Add catch block for AI decision errors with parameter
              toast({
                title: "Error de IA",
                description:
                  "No se pudo verificar la finalización del trabajo. Por favor, finaliza/inicia trabajos manualmente si es necesario.",
                variant: "destructive",
              });
            })
            .finally(() =>
              setAiLoading((prev) => ({ ...prev, jobCompletion: false })),
            ); // Ensure finally is attached to the catch block
        }
      }
    }, [
      workday,
      currentJob,
      currentLocation,
      toast,
      recordEvent,
      isJobModalOpen,
      aiLoading.jobCompletion,
    ]); // Dependency array for this useEffect
    // Dependency array for this useEffect

    const handleStartTracking = async () => {
      const safeCurrentLocation = sanitizeLocationPoint(currentLocation); // sanitizeLocationPoint returns LocationPoint | undefined
      if (!currentLocation) {
        // Check if currentLocation state is null
        toast({
          title: "Esperando Ubicación",
          description:
            "Aún no se ha obtenido tu ubicación. Iniciando jornada sin coordenadas iniciales.",
        }); // Show informative toast
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
        status: "tracking",
        locationHistory: safeCurrentLocation ? [safeCurrentLocation] : [], // Initialize history with start location if available
        events: [
          {
            id: crypto.randomUUID(),
            type: "SESSION_START",
            timestamp: startTime,
            location: safeCurrentLocation, // safeCurrentLocation is LocationPoint | undefined
            details: `Sesión iniciada por ${technicianName}`,
            workdayId: workdayId, // Link event to workday
            isSynced: false,
          },
        ],
        pauseIntervals: [],
        isSynced: false, // Workday is initially unsynced
        jobs: [], // Initialize jobs array
      };

      // Save to local DB first
      try {
        await localDb.workdays.add({
          ...newWorkday,
          startLocation: newWorkday.startLocation ?? null,
        }); // Convert undefined to null for Dexie
        setWorkday(newWorkday); // Update state with the new workday object
        toast({
          title: "Seguimiento Iniciado",
          description: "Tu jornada laboral ha comenzado.",
        });
        // First AI prompt after starting tracking (non-blocking)
        setTimeout(() => {
          setJobModalMode("new" as "new" | "summary"); // Explicitly cast
          setCurrentJobFormData({ description: "", summary: "" });
          setIsJobModalOpen(true);
          // Add the recordEvent call here as planned
          recordEvent(
            "NEW_JOB_PROMPT",
            safeCurrentLocation,
            undefined,
            "Prompt inicial después del inicio de sesión",
          );
        }, 100); // Small delay to ensure state updates before prompting

        setIsSavingToCloud(false); // Reset saving state
        setSyncStatus("syncing"); // Set status to syncing before initial sync
        try {
          // Add the try block for the sync operation
          await syncLocalDataToSupabase(); // Trigger sync after starting workday
          setSyncStatus("success");
        } catch (error: any) {
          // Add the error parameter to the catch block.
          console.error("Error triggering sync after starting workday:", error); // Closing brace for the catch block
          setSyncRetryActive(true);
          setSyncStatus("error"); // Set status to error on failure
        }
      } catch (dbError: any) {
        // Catch errors from local DB add operation with parameter
        console.error("Error saving new workday to local DB:", dbError);
        toast({
          title: "Error Local",
          description: "No se pudo guardar la jornada en tu dispositivo.",
          variant: "destructive",
        });
        setWorkday(null); // Revert state as local save failed
        return; // Stop execution if local save fails
      }
      setIsLoading(false); // Turn off loading state after local save and state update
    }; // Closing brace for handleStartTracking
    const handlePauseTracking = () => {
      if (!workday) {
        return; // Return early if workday is null
      }
      const now = Date.now();
      const newPauseInterval: PauseInterval = {
        // Define the newPauseInterval object here with proper type annotation
        id: crypto.randomUUID(), // Assign a new UUID
        workdayId: workday.id,
        startTime: now, // Ensure startTime is a number
        startLocation: sanitizeLocationPoint(currentLocation), // sanitizeLocationPoint returns LocationPoint | undefined
        isSynced: false, // Mark the new pause interval as unsynced
      };
      setWorkday((prev) => {
        // Use functional update pattern to ensure latest state
        if (!prev) return null; // Return null if previous state is null
        return {
          ...prev, // Spread previous state
          status: "paused",
          // Add the new pause interval to the array
          pauseIntervals: [...prev.pauseIntervals, newPauseInterval],
        };
      });

      recordEvent("SESSION_PAUSE", currentLocation); // recordEvent expects LocationPoint | null | undefined, currentLocation is LocationPoint | null
      setIsLoading(true);
      toast({
        title: "Seguimiento Pausado",
        description: "Tu jornada laboral está en pausa.",
      });
      // Start sync after UI updates and event recording
      setSyncStatus("syncing"); // Set status to syncing before sync
      syncLocalDataToSupabase()
        .then(() => {
          setSyncStatus("success");
        }) // Set status to success on successful sync
        .catch((error: any) => {
          // Add the error parameter to the catch block.
          console.error("Error triggering sync after pausing:", error); // Log the actual error // Closing brace for the catch block
          setSyncRetryActive(true); // Activate retry if initial sync fails
          setSyncStatus("error"); // Set status to error on failure
        });
    }; // Closing brace for handlePauseTracking function
    const handleResumeTracking = () => {
      if (!workday) return;
      setIsLoading(true);
      const now = Date.now();
      setWorkday((prev) => {
        if (!prev) return null;
        const updatedPauses = [...(prev.pauseIntervals || [])];
        const lastActivePauseIndex = updatedPauses.findIndex(
          (p) => p.startTime && !p.endTime,
        );
        if (lastActivePauseIndex > -1) {
          const currentPause = updatedPauses[lastActivePauseIndex];
          currentPause.endTime = now;
          currentPause.endLocation = sanitizeLocationPoint(currentLocation);
          currentPause.isSynced = false;
        }
        return {
          ...prev,
          status: "tracking",
          pauseIntervals: updatedPauses,
        };
      });
      recordEvent("SESSION_RESUME", currentLocation);
      toast({
        title: "Seguimiento Reanudado",
        description: "¡Bienvenido de nuevo! El seguimiento está activo.",
      });
      setIsLoading(false);
      setSyncStatus("syncing");
      syncLocalDataToSupabase()
        .then(() => {
          setSyncStatus("success");
        }) // Chain then
        .catch((error) => {
          console.error("Error triggering sync after resuming:", error);
          setSyncRetryActive(true);
          setSyncStatus("error");
        });
    };

    const handleJobFormSubmit = async (
      jobToSummarizeId: string | null,
    ): Promise<void> => {
      console.log(
        `handleJobFormSubmit called with jobId: ${jobToSummarizeId}, mode: ${jobModalMode}`,
      ); // Added logging for clarity
      const safeCurrentLocation = sanitizeLocationPoint(currentLocation);
      console.log(`handleJobFormSubmit called with jobId: ${jobToSummarizeId}`);

      if (!workday) {
        toast({
          title: "Error Interno",
          description: "Estado de jornada perdido.",
          variant: "destructive",
        }); // Show an error toast
        setIsJobModalOpen(false); // Close modal on error
        return; // Explicitly return void
      }

      if (jobModalMode === "new") {
        if (!safeCurrentLocation) {
          toast({
            title: "Ubicación Requerida",
            description:
              "No se puede iniciar un nuevo trabajo sin una ubicación válida.",
            variant: "destructive",
          });
          setIsSavingToCloud(false); // Ensure saving state is turned off if location is missing
          return; // Explicitly return void
        }

        const newJob: Job = {
          id: crypto.randomUUID(),
          description: currentJobFormData.description,
          startTime: Date.now(), // Ensure startTime is a number
          workdayId: workday?.id, // Add null check for workday
          startLocation: safeCurrentLocation,
          status: "active",
          isSynced: false,
        };
        // --- Logic for Starting a New Job ---
        console.log("Starting a new job...");
        setIsSavingToCloud(true);
        setWorkday((prev) =>
          prev
            ? { ...prev, jobs: [...prev.jobs, newJob], currentJobId: newJob.id }
            : null,
        );
        recordEvent(
          "JOB_START",
          safeCurrentLocation,
          newJob.id,
          `Nuevo trabajo iniciado: ${newJob.description}`,
        ); // Record job start event
        toast({
          title: "Nuevo Trabajo Iniciado",
          description: `Trabajo: "${currentJobFormData.description}"`,
        });
        setIsJobModalOpen(false);
        setSyncStatus("syncing"); // Set status to syncing before sync
        try {
          await syncLocalDataToSupabase(); // Trigger sync after starting a new job
          setSyncStatus("success"); // Set status to success on successful sync
        } catch (error: any) {
          console.error("Error triggering sync after starting new job:", error); // Log the actual error in catch block
          setSyncStatus("error"); // Set status to error on failure
          setSyncRetryActive(true);
          setIsSavingToCloud(false); // Ensure saving state is off on sync failure
          return; // Ensure a return statement in the catch block
        } finally {
          return; // Explicitly return void in the finally block after handling new job
        }
      }

      if (jobModalMode === "summary") {
        if (!jobToSummarizeId) {
          toast({
            title: "Error Interno",
            description: "ID de trabajo faltante para completar.",
            variant: "destructive",
          });
          return; // Return early if job ID is missing for summary mode
        }
        if (!workday) {
          // Add null check for workday
          toast({
            title: "Error Interno",
            description:
              "Estado de jornada perdido al intentar completar trabajo.",
            variant: "destructive",
          });
          return; // Return early if workday is null
        }
        const jobToUpdateIndex = workday.jobs.findIndex(
          (j) => j.id === jobToSummarizeId,
        );
        if (jobToUpdateIndex === -1) {
          // Check if the job was found
          toast({
            title: "Error Interno",
            description: "No se encontró el trabajo para completar.",
            variant: "destructive",
          });
          setSyncRetryActive(true);
          setSyncStatus("error");
          setCurrentJobFormData({ description: "", summary: "" });
          setJobToSummarizeId(null); // Reset job ID if job is not found
          setIsJobModalOpen(false); // Close modal on error
          return; // Return early if the job is not found
        }
        console.log("Workday before job completion update:", workday); // Log state before updating
        const jobBeforeCompletion = workday.jobs[jobToUpdateIndex];

        // 1. Immediately update local state to mark job as completed with user summary
        setWorkday((prev) => {
          if (!prev) return null;
          const updatedJobs = [...prev.jobs]; // Create a copy to avoid direct state modification
          updatedJobs[jobToUpdateIndex] = {
            // Update the specific job object in the array copy using the correct index
            ...jobBeforeCompletion, // Use data before AI call
            summary: currentJobFormData.summary,
            status: "completed",
            endTime: Date.now(),
            endLocation: safeCurrentLocation,
            isSynced: false,
          };
          console.log("Updated jobs state for completion:", updatedJobs); // Log the updated state
          return {
            ...prev,
            jobs: updatedJobs,
            currentJobId: null, // No current job after completion, explicitly set to null
          };
        }); // Close the setWorkday functional update

        // Record the job completion event immediately after local update
        recordEvent(
          "JOB_COMPLETED",
          safeCurrentLocation,
          jobBeforeCompletion.id,
          `Trabajo completado. Usuario: ${currentJobFormData.summary}`,
        );
        toast({
          title: "Trabajo Completado",
          description: `Resumen de usuario guardado para el trabajo.`,
        }); // Show toast for user summary saved
        setJobToSummarizeId(null);
        setIsJobModalOpen(false);

        try {
          setSyncStatus("syncing"); // Set status to syncing before sync
          // Await the sync operation to ensure local state is saved before potentially ending the day
          await syncLocalDataToSupabase(); // Trigger sync after completing a job (user summary saved)
          setSyncStatus("success"); // Set status to success on successful sync
        } catch (error: any) {
          console.error("Error triggering sync after completing job:", error);
          setSyncStatus("error"); // Set status to error
          setSyncRetryActive(true); // Keep existing retry activation
          return; // Ensure a return statement in the catch block
        } finally {
          setIsSavingToCloud(false); // Ensure saving state is off regardless of AI outcome
          setCurrentJobFormData({ description: "", summary: "" }); // Reset form data regardless of AI outcome
          // 2. Initiate AI summarization asynchronously (fire-and-forget)
          setAiLoading((prev) => ({ ...prev, summarize: true })); // Indicate AI is working by setting state
          summarizeJobDescription({
            jobDescription: jobBeforeCompletion.description || "N/A",
            userSummary: currentJobFormData.summary || "N/A",
          })
            .then(async (aiRes) => {
              // Use async in the then block to await inner promises
              console.log("AI Summarization result:", aiRes);
              console.log("AI Summarization successful:", aiRes.summary);
              // Update state with AI summary - this will trigger a re-render and subsequent sync
              setWorkday((prev) =>
                prev
                  ? {
                      ...prev,
                      jobs: prev.jobs.map((job) =>
                        job.id === jobToSummarizeId
                          ? {
                              ...job,
                              aiSummary: aiRes.summary,
                              isSynced: false,
                            }
                          : job,
                      ),
                    }
                  : null,
              );
              setAiReportGenerated(true); // Set AI report status to true
              toast({
                title: "Resumen IA",
                description: "Resumen automático del trabajo añadido.",
              });
              setSyncStatus("syncing"); // Set status to syncing before sync for the AI summary
              // Trigger sync after AI summary is added to state (non-blocking)
              await syncLocalDataToSupabase(); // Trigger sync after AI summary update
              setSyncStatus("success"); // Set status to success on successful sync after AI summary
            })
            .catch((err) => {
              // Add catch block for AI summarization errors with parameter
              console.error("AI Summarization failed:", err);
              setSyncStatus("error"); // Set status to error if AI fails
              return; // Ensure a return statement in the catch block
            })
            .finally(
              async () => {
                // Finally block after AI attempt - Added async here
                setWorkday((latestWorkdayState) => {
                  // Functional update
                  if (!latestWorkdayState) return null;
                  const jobIsLocallyCompleted =
                    latestWorkdayState.jobs.find(
                      (j) => j.id === jobToSummarizeId,
                    )?.status === "completed";
                  if (jobIsLocallyCompleted) {
                    // Pass the latest state from the updater function to initiateEndDayProcess
                    initiateEndDayProcess(
                      latestWorkdayState,
                      toast,
                      setIsLoading,
                      setWorkday,
                      setEndOfDaySummary,
                      setSyncStatus,
                      setSyncRetryActive,
                    );
                    return latestWorkdayState; // Return the state from the functional update
                  }
                  return latestWorkdayState; // Always return the latest state
                }); // Close the setWorkday functional update
              }, // This brace closes the if (jobModalMode === 'summary') block
            )
            .finally(() =>
              setAiLoading((prev) => ({ ...prev, summarize: false })),
            ); // Ensure AI loading is off after summarization attempt
        }
 return; // Ensure a return statement at the end of handleJobFormSubmit
 }; // Closing brace for handleJobFormSubmit
      const handleEndDay = async (): Promise<void> => {
        // Placeholder function - replace with actual implementation
        console.log("Placeholder handleEndDay called");
        const activeJob = workday?.jobs.find(
          (j) => j.id === workday.currentJobId && j.status === "active",
        ); // Find the active job
        if (activeJob) {
          // If there is an active job, open the summary modal for that job first
          setIsJobModalOpen(true);
          recordEvent(
            "JOB_COMPLETION_PROMPT",
            currentLocation,
            activeJob.id,
            "Prompt al finalizar el día",
          );
          return; // Stop here, the process will continue after the job form submit
        }

        // If no active job, proceed directly to initiating the end day process
        // Call initiateEndDayProcess with the current state of the workday.   // This is safe because initiateEndDayProcess will make a shallow copy, but for state updates it's better to use functional updates.
        if (!workday) {
          // Add a check if workday is null
          console.error(
            "Workday became null unexpectedly before initiateEndDayProcess could be called.",
          );
          toast({
            title: "Error Interno",
            description: "Estado de jornada perdido al intentar finalizar.",
            variant: "destructive",
          }); // Ensure variant is literal
          return;
        }
        initiateEndDayProcess(
          workday,
          toast,
          setIsLoading,
          setWorkday,
          setEndOfDaySummary,
          setSyncStatus,
          setSyncRetryActive,
        );
      }; // Closing brace for handleEndDay function

      const handleManualCompleteJob = (): void => {
        // Only proceed if there is an active job
        if (currentJob) {
          setJobToSummarizeId(currentJob.id); // Ensure jobToSummarizeId is set to the active job's ID
          setJobModalMode("summary" as "new" | "summary"); // Explicitly cast
          setCurrentJobFormData({
            description: currentJob.description || "",
            summary: "",
          }); // Ensure description is string
          setIsJobModalOpen(true);
          recordEvent(
            "USER_ACTION",
            currentLocation,
            currentJob.id,
            "Modal de completar trabajo abierto manualmente",
          );
        } else {
          toast({
            title: "Error",
            description: "No hay un trabajo activo para completar manualmente.",
            variant: "destructive",
          });
        }
        return; // Explicitly return void
      };
      const handleManualStartNewJob = (): void => {
        // Check if a job is already active
        if (currentJob) {
          toast({
            title: "Ya hay un trabajo activo",
            description:
              "Completa el trabajo actual antes de iniciar uno nuevo.",
            variant: "default",
          });
          return;
        }
        const safeCurrentLocation = sanitizeLocationPoint(currentLocation);
        if (!safeCurrentLocation) {
          toast({
            title: "Ubicación Requerida",
            description:
              "No se puede iniciar un nuevo trabajo sin una ubicación válida.",
            variant: "destructive",
          });
          return;
        }
        setJobModalMode("new" as "new" | "summary"); // Explicitly cast to literal type
        setCurrentJobFormData({ description: "", summary: "" }); // Set initial form data
        setIsJobModalOpen(true); // Open the modal
        setJobToSummarizeId(null);
        recordEvent(
          "USER_ACTION",
          safeCurrentLocation,
          undefined,
          "Modal de nuevo trabajo abierto manualmente",
        ); // Record the event
        return; // Explicitly return void
      };


 return (
 <TechTrackAppContent
      {...{
        workday,
        currentLocation,
        geolocationError,
        elapsedTime,
        isJobModalOpen,
        jobModalMode,
        currentJobFormData,
        endOfDaySummary,
        isSavingToCloud,
        isLoading,
        aiLoading,
        syncStatus,
        aiReportGenerated,
        syncRetryActive,
        jobToSummarizeId,
        technicianName,
        currentJob,
        handleStartTracking,
        handlePauseTracking,
        handleResumeTracking,
        handleEndDay,
        handleManualCompleteJob,
        handleManualStartNewJob,
        setIsJobModalOpen,
        setCurrentJobFormData,
        handleJobFormSubmit,
        setJobToSummarizeId,
      }}
    />
  ); // Return the component
}
interface TechTrackAppContentProps extends TechTrackAppProps {  workday: Workday | null;  currentLocation: LocationPoint | null; // Adjusted type for clarity as state is LocationPoint | null
  geolocationError: GeolocationError | null; // Keep this for user feedback
  elapsedTime: number;
  isJobModalOpen: boolean;
  jobModalMode: "new" | "summary";
  currentJobFormData: { description: string; summary: string };
  endOfDaySummary: WorkdaySummaryContext | null;
  isSavingToCloud: boolean;
  isLoading: boolean;
  aiLoading: Record<string, boolean>;
  syncStatus: "idle" | "syncing" | "success" | "error";
  aiReportGenerated: boolean; // New state for AI report status
  syncRetryActive: boolean;
  jobToSummarizeId: string | null;
  currentJob: Job | null;
  handleStartTracking: () => Promise<void>;
  handlePauseTracking: () => void;
  handleResumeTracking: () => void;
  handleEndDay: () => Promise<void>;
  handleManualCompleteJob: () => void;
  handleManualStartNewJob: () => void;
  setIsJobModalOpen: (isOpen: boolean) => void;
  setCurrentJobFormData: (data: {
    description: string;
    summary: string;
  }) => void;
  handleJobFormSubmit: (
 jobToSummarizeId: string | null, // Correct type based on usage
    isEndingDaySubmit?: boolean,
  ) => Promise<void>;
  setJobToSummarizeId: (jobId: string | null) => void;}

function TechTrackAppContent({ // Change return type to allow null
        workday,
        currentLocation,
        geolocationError,
        elapsedTime,
        isJobModalOpen,
        jobModalMode,
        currentJobFormData,
        endOfDaySummary,
        isSavingToCloud, // New state for overall saving process
        isLoading,
        aiLoading, // New state for AI loading indicators
        syncStatus, // New state for overall sync status
        aiReportGenerated, // New state for AI report status
        syncRetryActive,
        jobToSummarizeId,
        technicianName,
        currentJob,
        handleStartTracking,
        handlePauseTracking,
        handleResumeTracking,
        // handleManualEndDay, // Receive the new prop // This prop is not defined in the interface and not used
        handleEndDay,
        handleManualCompleteJob,
        handleManualStartNewJob,
        setIsJobModalOpen,
        setCurrentJobFormData,
        handleJobFormSubmit,
        setJobToSummarizeId,
}: TechTrackAppContentProps): JSX.Element {
    let contentToRender: JSX.Element | null = null; // Initialize variable to hold JSX

  const getGoogleMapsLink = (location: LocationPoint | null | undefined) =>
    location
      ? `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`
      : "#"; // Adjusted to accept null/undefined
    if (!workday || workday.status === "idle") {
      return ( // Render content for idle state
        <div className="flex flex-col items-center justify-center h-full p-4">
          <Card className="w-full max-w-sm">
            <CardHeader>
              <CardTitle>Iniciar Jornada Laboral</CardTitle>
              <CardDescription>
                Prepárate para comenzar tu día de seguimiento.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center space-y-4">
              <User className="w-12 h-12 text-muted-foreground" />
              <p className="text-center text-muted-foreground">
                Técnico: {technicianName}
              </p>
              {currentLocation && (
                <LocationInfo
                  location={currentLocation}
                  error={geolocationError}
                  label="Ubicación Actual"
                  getGoogleMapsLink={getGoogleMapsLink}
                />
              )}
            </CardContent>
            <CardFooter className="flex justify-center">
              <Button
                onClick={handleStartTracking}
                disabled={isLoading || isSavingToCloud} // Disable button while loading or saving
              >
                {isLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                Iniciar Seguimiento
              </Button>
            </CardFooter>
          </Card>
          <p className="text-center text-sm text-muted-foreground mt-4">
            Tu ubicación es necesaria para iniciar el seguimiento. Asegúrate
            de que los permisos de geolocalización estén activados.
          </p>
          <Link href="/history" passHref>
            <Button variant="link" className="mt-2">
              <History className="mr-2 h-4 w-4" />
              Ver Historial
            </Button>
          </Link>
        </div>
      );
    } // Remove the return statement here

    if (workday.status === "tracking" || workday.status === "paused") { // Render content for tracking or paused state
      const syncIndicator =
        syncStatus === "syncing" ? (
          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
        ) : syncStatus === "success" ? (
          <CheckCircle className="h-4 w-4 text-green-500" />
        ) : syncStatus === "error" ? (
          <AlertTriangle className="h-4 w-4 text-red-500" />
        ) : syncRetryActive ? ( // Show a different icon if retry is active after an error
          <CloudUpload className="h-4 w-4 text-orange-500" />
        ) : null;

      return (
            <div className="flex flex-col items-center p-4 space-y-6 h-full">
              <h1 className="text-2xl font-bold">{technicianName}'s Workday</h1>
              <Card className="w-full max-w-md">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Tiempo Transcurrido
                  </CardTitle>
                  {syncIndicator}
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    <Clock className="inline-block mr-2 h-6 w-6 text-primary" />
                    {formatTime(elapsedTime)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Desde el inicio de la jornada
                  </p>
                  <CurrentStatusDisplay
                    status={workday.status}
                    currentJob={currentJob}
                    aiLoading={aiLoading}
                  />{" "}
                  {/* Pass aiLoading state */}
                  <LocationInfo
                    location={currentLocation}
                    error={geolocationError}
                    label="Current Location"
                    getGoogleMapsLink={getGoogleMapsLink}
                  />
                </CardContent>
                <CardFooter className="flex space-x-2">
                  {workday.status === "tracking" ? (
                    <Button
                      onClick={handlePauseTracking}
                      disabled={
                        isLoading || isSavingToCloud || syncStatus === "syncing"
                      }
                      className="w-1/2"
                    >
                      {isLoading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Pause className="mr-2 h-4 w-4" />
                      )}
                      Pausar
                    </Button>
                  ) : (
                    <Button
                      onClick={handleResumeTracking}
                      disabled={
                        isLoading || isSavingToCloud || syncStatus === "syncing"
                      }
                      className="w-1/2"
                    >
                      {isLoading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="mr-2 h-4 w-4" />
                      )}
                      Reanudar
                    </Button>
                  )}
                  <Button
                    onClick={handleEndDay} // Call the handler passed from the parent
                    disabled={
                      isLoading || isSavingToCloud || syncStatus === "syncing"
                    }
                    variant="destructive"
                    className="w-1/2"
                  >
                    {isLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <StopCircle className="mr-2 h-4 w-4" />
                    )}
                    Finalizar Día
                  </Button>
                </CardFooter>
              </Card>

              <Card className="w-full max-w-md">
                <CardHeader>
                  <CardTitle>Gestionar Trabajos</CardTitle>
                  <CardDescription>
                    Inicia, completa o revisa tus trabajos.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex space-x-2">
                  <Button
                    onClick={handleManualStartNewJob}
                    disabled={
                      isLoading ||
                      isSavingToCloud ||
                      syncStatus === "syncing" ||
                      !currentLocation
                    }
                    className="w-1/2"
                  >
                    <Briefcase className="mr-2 h-4 w-4" />
                    Nuevo Trabajo
                  </Button>
                  <Button
                    onClick={handleManualCompleteJob}
                    disabled={
                      isLoading ||
                      isSavingToCloud ||
                      !currentJob ||
                      syncStatus === "syncing" ||
                      !currentLocation
                    }
                    className="w-1/2"
                    variant="secondary"
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Completar Trabajo
                  </Button>
                </CardContent>
              </Card>

              {endOfDaySummary && (
                <Card className="w-full max-w-md">
                  <CardHeader>
                    <CardTitle>Resumen del Día</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <WorkdaySummaryDisplay summary={endOfDaySummary} />
                  </CardContent>
                </Card>
              )}

              <Link href="/history" passHref>
                <Button variant="link" className="mt-2">
                  <History className="mr-2 h-4 w-4" />
                  Ver Historial
                </Button>
              </Link>

              {/* Job Modal */}
              <Dialog open={isJobModalOpen} onOpenChange={setIsJobModalOpen}>
                <DialogContent className="sm:max-w-[425px]">
                  <DialogHeader>
                    <DialogTitle>
                      {jobModalMode === "new"
                        ? "Iniciar Nuevo Trabajo"
                        : "Completar Trabajo Actual"}
                    </DialogTitle>
                    <DialogDescription>
                      {jobModalMode === "new"
                        ? "Introduce la descripción del nuevo trabajo."
                        : "Introduce un resumen de las tareas completadas."}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label htmlFor="description" className="text-right">
                        Description
                      </Label>
                      <Textarea
                        id="description"
                        value={currentJobFormData.description}
                        onChange={(e) =>
                          setCurrentJobFormData({
                            ...currentJobFormData,
                            description: e.target.value,
                          })
                        }
                        className="col-span-3"
                        placeholder={
                          jobModalMode === "new"
                            ? "Escribe una breve descripción del trabajo..."
                            : currentJob?.description || ""
                        }
                        disabled={jobModalMode !== "new"} // Disable description input in summary mode
                      />
                    </div>
                    {jobModalMode === "summary" && (
                      <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="summary" className="text-right">
                          Summary
                        </Label>
                        <Textarea
                          id="summary"
                          value={currentJobFormData.summary}
                          onChange={(e) =>
                            setCurrentJobFormData({
                              ...currentJobFormData,
                              summary: e.target.value,
                            })
                          }
                          className="col-span-3"
                          placeholder="Escribe un resumen de las tareas completadas..."
                        />
                      </div>
                    )}
                  </div>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button type="button" variant="secondary">
                        Cancelar
                      </Button>
                    </DialogClose>
                    <Button
                      onClick={() => {
                        handleJobFormSubmit(
                          jobModalMode === "summary" ? jobToSummarizeId : null,
                        );
                      }}
                      disabled={
                        isSavingToCloud ||
                        syncStatus === "syncing" ||
                        (jobModalMode === "new" &&
                          !currentJobFormData.description) ||
                        (jobModalMode === "summary" &&
                          !currentJobFormData.summary)
                      }
                    >
                      {isSavingToCloud || syncStatus === "syncing" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : jobModalMode === "new" ? (
                        "Iniciar Trabajo"
                      ) : (
                        "Completar Trabajo"
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          );
        }
    if (workday.status === "ended") { // Render content for ended state // Remove the return statement here
      const syncIndicator =
        syncStatus === "syncing" ? (
          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
        ) : syncStatus === "success" ? (
          <CheckCircle className="h-4 w-4 text-green-500" />
        ) : syncStatus === "error" ? (
          <AlertTriangle className="h-4 w-4 text-red-500" />
        ) : syncRetryActive ? (
          <CloudUpload className="h-4 w-4 text-orange-500" />
        ) : null;

      return (
            <div className="flex flex-col items-center justify-center h-full p-4 space-y-4">
              <Card className="w-full max-w-sm">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Jornada Finalizada
                  </CardTitle>
                  {syncIndicator}
                </CardHeader>
                <CardContent className="text-center space-y-2">
                  <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
                  <p className="text-xl font-semibold">
                    Tu jornada ha terminado&apos;.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Duración total: {formatTime(elapsedTime)}
                  </p>
                  {endOfDaySummary && (
                    <div className="mt-4">
                      <CardDescription>Resumen del Día:</CardDescription>
                      <WorkdaySummaryDisplay summary={endOfDaySummary} />
                    </div>
                  )}
                </CardContent>
                <CardFooter className="flex justify-center">
                  <Link href="/history" passHref>
                    <Button variant="link">
                      <History className="mr-2 h-4 w-4" />
                      Ver Historial Completo
                    </Button>
                  </Link>
                </CardFooter>
              </Card>
              <p className="text-center text-sm text-muted-foreground">
                Gracias por usar TechTrack hoy.
              </p>
            </div>
          );
    } // Closing brace for renderContent function

    return null; // Should ideally not reach here if workday status is always one of the defined states
  }
}
// The function now implicitly returns JSX.Element or null based on the conditional blocks