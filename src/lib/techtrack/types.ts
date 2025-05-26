
export interface LocationPoint {
  latitude: number;
  longitude: number;
  timestamp: number;
  accuracy?: number;
}

export type JobStatus = 'active' | 'completed' | 'cancelled';

export interface Job {
  id: string;
  workdayId: string;
  description: string;
  startTime: number;
  startLocation?: LocationPoint;
  endTime?: number;
  endLocation?: LocationPoint;
  summary?: string; // Technician's summary
  aiSummary?: string; // AI-generated summary
  status: JobStatus;
}


export type TrackingStatus = 'idle' | 'tracking' | 'paused' | 'ended';
export type TrackingEventType =
    | 'SESSION_START' 
    | 'WORKDAY_START' // Added
    | 'WORKDAY_END' // Added
    | 'PAUSE_START' // Added
    | 'PAUSE_END' // Added
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


export interface TrackingEvent {
  id: string; // Added id
  workdayId: string; // Added workdayId
  timestamp: number;
  location?: LocationPoint;
  jobId?: string;
  details?: string;
  isSynced: boolean; // Added isSynced
}

export interface PauseInterval {
  id: string;
  workdayId: string; // Added workdayId
  startTime: number | null;
  endTime?: number | null;
  startLocation?: LocationPoint;
  endLocation?: LocationPoint;
  isSynced: boolean; // Added isSynced
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
  // locationHistory: LocationPoint[]; // Removed locationHistory
  jobs: Job[];
  events: TrackingEvent[];
  pauseIntervals: PauseInterval[];
  lastNewJobPromptTime?: number;
  lastJobCompletionPromptTime?: number;
  currentJobId?: string | null;
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

