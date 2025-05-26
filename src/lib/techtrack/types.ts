
export interface LocationPoint {
  latitude: number;
  longitude: number;
  timestamp: number;
  accuracy?: number;
}

export interface Job {
  id: string;
  description: string;
  startTime: number;
  startLocation: LocationPoint;
  endTime?: number;
  endLocation?: LocationPoint;
  summary?: string; // Technician's summary
  aiSummary?: string; // AI-generated summary
  status: 'active' | 'completed';
}

export type TrackingStatus = 'idle' | 'tracking' | 'paused' | 'ended';

export interface TrackingEvent {
  id: string;
  type: 
    | 'SESSION_START' 
    | 'SESSION_PAUSE' 
    | 'SESSION_RESUME' 
    | 'SESSION_END' 
    | 'LOCATION_UPDATE' 
    | 'JOB_START' 
    | 'JOB_DETAILS_UPDATED'
    | 'JOB_COMPLETION_PROMPT'
    | 'JOB_COMPLETED'
    | 'NEW_JOB_PROMPT'
    | 'USER_ACTION' // Added for manual user interactions
    | 'ERROR';
  timestamp: number;
  location?: LocationPoint;
  jobId?: string;
  details?: string; 
}

export interface PauseInterval {
  id: string; // Use a specific type like string or number instead of any
  startTime: number | null;
  endTime?: number | null;
  startLocation?: LocationPoint;
  endLocation?: LocationPoint;
}

export interface Workday {
  id: string;
  userId: string; // Future use
  date: string; // YYYY-MM-DD
  startTime?: number;
  startLocation?: LocationPoint | null;
  endTime?: number;
  endLocation?: LocationPoint | null;
  status: TrackingStatus;
  locationHistory: LocationPoint[];
  jobs: Job[];
  events: TrackingEvent[];
  pauseIntervals: PauseInterval[];
  lastNewJobPromptTime?: number;
  lastJobCompletionPromptTime?: number;
  currentJobId?: string | null; // Fix the type here as well
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any; // Allow any other properties for now
}

export interface WorkdaySummaryContext extends Workday {
  totalActiveTime: number; // in milliseconds
  totalPausedTime: number; // in milliseconds
  totalDistanceKm: number;
}

export interface GeolocationError {
  code: number;
  message: string;
}

export function isError(error: unknown): error is Error {
  return error instanceof Error;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-enable @typescript-eslint/no-explicit-any */

