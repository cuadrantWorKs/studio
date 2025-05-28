import Dexie, { Table } from 'dexie';
import { Workday, Job, TrackingEvent, PauseInterval } from './lib/techtrack/types';

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
  workdays!: Table<Workday, string>;
  locations!: Table<Location>;
  technicians!: Table<Technician>;
  jobs!: Table<Job, string>;
  events!: Table<TrackingEvent, string>;
  pauseIntervals!: Table<PauseInterval, string>;

  constructor() {
    super('TechTrackLocalDB'); // Database name
    this.version(1).stores({
      workdays: '&id, technicianId, userId, date, startTime, endTime, isSynced, status',
      locations: '++id, workdayId, timestamp, isSynced', // Added workdayId for indexing
      jobs: '&id, workdayId, isSynced, status',
      events: '&id, workdayId, isSynced, type', // Added based on schema
      technicians: '++id, name',
    });
  }
}

export const db = new LocalDatabase();