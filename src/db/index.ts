import Dexie, { Table } from "dexie";

export interface Workday {
  // Represents a technician's work session
  id?: number; // Primary key
  technicianId: string;
  startTime: Date;
  endTime?: Date;
  // Add other workday properties here
  isSynced: boolean; // To track synchronization status
}

export interface Location {
  // Represents a technician's location at a specific time
  id?: number; // Primary key
  workdayId: number; // Foreign key to Workday
  timestamp: Date;
  latitude: number;
  longitude: number;
  // Add other location properties here
  isSynced: boolean; // To track synchronization status
}

export interface Technician {
  // Represents a field technician
  id?: number; // Primary key
  name: string;
  // Add other technician properties here
}

export class LocalDatabase extends Dexie {
  workdays!: Table<Workday>;
  locations!: Table<Location>;
  technicians!: Table<Technician>;

  constructor() {
    super("TechTrackLocalDB"); // Database name
    this.version(1).stores({
      workdays: "++id, technicianId, startTime, endTime, isSynced",
      locations: "++id, workdayId, timestamp, isSynced",
      technicians: "++id, name",
    });
  }
}

export const db = new LocalDatabase();
