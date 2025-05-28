// src/lib/techtrack/sync.ts
import { db as localDb } from '@/db'; // Import your local Dexie database instance
import { db as supabaseDb } from '@/lib/supabase'; // Import your Supabase client instance
import type { Workday, Job, TrackingEvent, PauseInterval, LocationPoint } from './types'; // Import types from types.ts
import { isError } from './types';

export async function syncLocalDataToSupabase() {
  // Check network status before attempting sync
  if (!navigator.onLine) {
    console.log('Synchronization skipped: Application is offline.');
    return;
  }
  console.log('Starting local data synchronization to Supabase...');

  try {
    // Sync Workdays
    const unsyncedWorkdays = await localDb.workdays.filter(item => !item.isSynced).toArray();
    if (unsyncedWorkdays.length > 0) {
      console.log(`Attempting to sync ${unsyncedWorkdays.length} unsynced workdays.`);
      const workdaysToUpsert = unsyncedWorkdays.map((workday: Workday) => ({
        id: workday.id,
        technician_id: workday.technicianId,
        user_id: workday.userId,
        date: workday.date,
        start_time: typeof workday.startTime === 'number' ? new Date(workday.startTime).toISOString() : null,
        start_location: workday.startLocation ?? null,
        end_time: typeof workday.endTime === 'number' ? new Date(workday.endTime).toISOString() : null,
        end_location: workday.endLocation ?? null,
        status: workday.status,
        is_synced: true, // Mark as synced in the data being sent
      }));
      const { error: workdayError } = await supabaseDb.from('workdays').upsert(workdaysToUpsert, { onConflict: 'id' });
      if (workdayError) {
        console.error('Error syncing workdays to Supabase:', workdayError);
        // Depending on requirements, might throw or mark specific workdays as errored locally
      } else {
        console.log(`${unsyncedWorkdays.length} workdays synced successfully.`);
        // Mark successfully synced workdays in local DB
        for (const workday of unsyncedWorkdays) {
          await localDb.workdays.update(workday.id!, { isSynced: true });
        }
      }
    } else {
      console.log('No unsynced workdays to sync.');
    }

    // Sync Locations
    const unsyncedLocations = await localDb.locations.filter(item => !item.isSynced).toArray();
    if (unsyncedLocations.length > 0) {
      console.log(`Attempting to sync ${unsyncedLocations.length} unsynced locations.`);
      const locationsToInsert = unsyncedLocations.map((location: LocationPoint & { workdayId: string, isSynced: boolean, id?: number }) => ({
        workday_id: location.workdayId,
        latitude: location.latitude,
        longitude: location.longitude,
        timestamp: typeof location.timestamp === 'number' ? new Date(location.timestamp).toISOString() : null,
        accuracy: location.accuracy ?? null, // Handle optional accuracy
      }));
      // Locations are typically inserted, not upserted, as they are point-in-time records
      const { error: locationsError } = await supabaseDb.from('locations').insert(locationsToInsert);
      if (locationsError) {
        console.error('Error syncing locations to Supabase:', locationsError);
      } else {
        console.log(`${unsyncedLocations.length} locations synced successfully.`);
        // Mark successfully synced locations in local DB
        for (const location of unsyncedLocations) {
          await localDb.locations.update(location.id!, { isSynced: true });
        }
      }
    } else {
      console.log('No unsynced locations to sync.');
    }

    // Sync Jobs
    const unsyncedJobs = await localDb.jobs.filter(item => !item.isSynced).toArray();
    if (unsyncedJobs.length > 0) {
      console.log(`Attempting to sync ${unsyncedJobs.length} unsynced jobs.`);
      const jobsToUpsert = unsyncedJobs.map((job: Job) => ({
        id: job.id,
        workday_id: job.workdayId,
        description: job.description,
        summary: job.summary ?? null,
        ai_summary: job.aiSummary ?? null,
        start_time: typeof job.startTime === 'number' ? new Date(job.startTime).toISOString() : null,
        start_location: job.startLocation ?? null,
        end_time: typeof job.endTime === 'number' ? new Date(job.endTime).toISOString() : null,
        end_location: job.endLocation ?? null, // Use job.endLocation directly with nullish coalescing
        status: job.status,
        is_synced: true, // Mark as synced in the data being sent
      }));
      const { error: jobsError } = await supabaseDb.from('jobs').upsert(jobsToUpsert, { onConflict: 'id' });
      if (jobsError) {
        console.error('Error syncing jobs to Supabase:', jobsError);
      } else {
        console.log(`${unsyncedJobs.length} jobs synced successfully.`);
        // Mark successfully synced jobs in local DB
        for (const job of unsyncedJobs) {
          await localDb.jobs.update(job.id!, { isSynced: true });
        }
      }
    } else {
      console.log('No unsynced jobs to sync.');
    }

    // Sync Pause Intervals
    const unsyncedPauseIntervals = await localDb.pauseIntervals.filter(item => !item.isSynced).toArray();
    if (unsyncedPauseIntervals.length > 0) {
      console.log(`Attempting to sync ${unsyncedPauseIntervals.length} unsynced pause intervals.`);
      const pauseIntervalsToUpsert = unsyncedPauseIntervals.map((pauseInterval: PauseInterval) => ({
        id: pauseInterval.id,
        workday_id: pauseInterval.workdayId,
        start_time: typeof pauseInterval.startTime === 'number' ? new Date(pauseInterval.startTime).toISOString() : null,
        start_location: pauseInterval.startLocation ?? null,
        end_time: typeof pauseInterval.endTime === 'number' ? new Date(pauseInterval.endTime).toISOString() : null,
        end_location: pauseInterval.endLocation ?? null, // Assuming DbPauseInterval already has LocationPoint | null
        is_synced: true, // Mark as synced in the data being sent
      }));
      const { error: pausesError } = await supabaseDb.from('pause_intervals').upsert(pauseIntervalsToUpsert, { onConflict: 'id' });
      if (pausesError) {
        console.error('Error syncing pause intervals to Supabase:', pausesError);
      } else {
        console.log(`${unsyncedPauseIntervals.length} pause intervals synced successfully.`);
        // Mark successfully synced pause intervals in local DB
        for (const pauseInterval of unsyncedPauseIntervals) {
          await localDb.pauseIntervals.update(pauseInterval.id!, { isSynced: true });
        }
      }
    } else {
      console.log('No unsynced pause intervals to sync.');
    }

    // Sync Events
    const unsyncedEvents = await localDb.events.filter(item => !item.isSynced).toArray();
    if (unsyncedEvents.length > 0) {
      console.log(`Attempting to sync ${unsyncedEvents.length} unsynced events.`);
      const eventsToUpsert = unsyncedEvents.map((event: TrackingEvent) => ({
        id: event.id,
        workday_id: event.workdayId,
        type: event.type,
        timestamp: typeof event.timestamp === 'number' ? new Date(event.timestamp).toISOString() : null,
        job_id: event.jobId ?? null,
        details: event.details ?? null,
        location: event.location ?? null, // Assuming DbTrackingEvent already has LocationPoint | null
        is_synced: true, // Mark as synced in the data being sent
      }));
      const { error: eventsError } = await supabaseDb.from('events').upsert(eventsToUpsert, { onConflict: 'id' });
      if (eventsError) {
        console.error('Error syncing events to Supabase:', eventsError);
      } else {
        console.log(`${unsyncedEvents.length} events synced successfully.`);
        // Mark successfully synced events in local DB
        for (const event of unsyncedEvents) {
          await localDb.events.update(event.id!, { isSynced: true });
        }
      }
    } else {
      console.log('No unsynced events to sync.');
    }

    // Consider adding logic to sync other tables if necessary based on your schema
    // Example for Technicians (if technicians can be added/modified offline)
    // const unsyncedTechnicians = await localDb.technicians.filter(item => !item.isSynced).toArray();
    // for (const technician of unsyncedTechnicians) {
    //   const { error } = await supabaseDb.from('technicians').upsert([technician]);
    //   if (error) console.error('Error syncing technician:', error);
    //   else await localDb.technicians.update(technician.id!, { isSynced: true });
    // }

  } catch (generalError: any) {
    console.error('An error occurred during synchronization:', generalError);
    // Optionally propagate the error or handle it more specifically
    throw generalError; // Re-throw to allow calling code to handle sync failures
  }

  console.log('Local data synchronization process finished.');
}