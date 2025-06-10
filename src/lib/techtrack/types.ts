
export interface LocationPoint {
  latitude: number;
  longitude: number;
  timestamp: number;
 accuracy: number | null;
}

export interface Job {
  id: string;
  description: string;
  startTime: number;
 startLocation: LocationPoint | null; // Assuming a job can start without immediate precise location
 endTime: number | null;
 endLocation: LocationPoint | null;
 summary: string | null; // Technician's summary
 aiSummary: string | null; // AI-generated summary
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
 location: LocationPoint | null;
  jobId: string | null;
  details: string | null;
}
export interface PauseInterval {
  startTime: number;
  id: string;
  endTime: number | null;
  startLocation: LocationPoint | null;
  endLocation: LocationPoint | null;
}
// Note: optional fields are explicitly | null to align with DB schema
export interface Workday {
  id: string;
  userId: string; // Future use
  date: string; // YYYY-MM-DD
  startTime?: number;
 startLocation: LocationPoint | null;
 endTime: number | null;
 endLocation: LocationPoint | null;
  status: TrackingStatus;
  locationHistory: LocationPoint[];
  jobs: Job[];
  events: TrackingEvent[];
  pauseIntervals: PauseInterval[];
 lastNewJobPromptTime: number | null;
 lastJobCompletionPromptTime: number | null;
 currentJobId: string | null;
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

