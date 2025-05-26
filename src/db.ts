import Dexie, { Table } from 'dexie';
import { Job, PauseInterval, TrackingEvent, LocationPoint, TrackingStatus } from './lib/techtrack/types';

export interface Workday {
  id: string; // Primary key (UUID)
  technicianId: string; // Assuming you still want to keep this or map from userId
  userId: string; // Added based on error
  date: string; // Added based on error
  startTime: number; 
  endTime?: number; 
  isSynced: boolean; // To track synchronization status
  startLocation: LocationPoint | null; 
  endLocation?: LocationPoint | null; 
  status: TrackingStatus; 
  jobs: Job[];
  events: TrackingEvent[];
  pauseIntervals: PauseInterval[];
}
export interface Location {
  id?: number; // Primary key
  workdayId: string; // Foreign key to Workday (changed to string to match Workday ID)
  timestamp: number; // Changed from Date to number
  latitude: number;
  longitude: number;
  isSynced: boolean; // To track synchronization status
  accuracy: number; 
}

export interface Technician {
  id?: number; // Primary key
  name: string;
  // Add other technician properties here
}

// Assuming these types are defined elsewhere in your project

export class LocalDatabase extends Dexie {
  workdays!: Table<Workday>;
  locations!: Table<Location>;
  technicians!: Table<Technician>;

  constructor() {
    super('TechTrackLocalDB'); // Database name
    this.version(1).stores({
      workdays: '&id, technicianId, userId, date, startTime, endTime, isSynced, status',
      locations: '++id, workdayId, timestamp, isSynced', // Added workdayId for indexing
      jobs: '&id, workdayId, isSynced, status',
      events: '&id, workdayId, isSynced, type', // Added based on schema
      pauseIntervals: '&id, workdayId, isSynced', // Added based on schema
      technicians: '++id, name',
    });
  }
}

export const db = new LocalDatabase();