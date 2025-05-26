// src/lib/techtrack/sync.ts
import { db as localDb } from '@/db'; // Import your local Dexie database instance
import { db as supabaseDb } from '@/lib/supabase'; // Import your Supabase client instance

export async function syncLocalDataToSupabase() {
  // Check network status before attempting sync
  if (!navigator.onLine) {
    console.log('Synchronization skipped: Application is offline.');
    return;
  }
  console.log('Starting local data synchronization to Supabase...');

  try {
    // Sync Workdays
    const unsyncedWorkdays = await localDb.workdays.where('isSynced').equals(false).toArray();
    for (const workday of unsyncedWorkdays) {
      console.log('Syncing workday:', workday);
      // Assuming your Supabase table is named 'workdays'
      const { data, error } = await supabaseDb.from('workdays').upsert([workday]);
      if (error || !data) {
        console.error('Error syncing workday to Supabase:', error);
        // Optionally throw error or handle it (e.g., mark as failed in localDb)
      } else {
        console.log('Workday synced successfully:', data);
        await localDb.workdays.update(workday.id!, { isSynced: true });
        console.log('Workday marked as synced in local DB.');
      }
    }

    // Sync Locations
    const unsyncedLocations = await localDb.locations.where('isSynced').equals(false).toArray();
    for (const location of unsyncedLocations) {
      console.log('Syncing location:', location);
      // Assuming your Supabase table is named 'locations'
      const { data, error } = await supabaseDb.from('locations').upsert([location]);
      if (error || !data) {
        console.error('Error syncing location to Supabase:', error);
        // Optionally throw error or handle it (e.g., mark as failed in localDb)
      } else {
        console.log('Location synced successfully:', data);
        await localDb.locations.update(location.id!, { isSynced: true });
        console.log('Location marked as synced in local DB.');
      }
 }

    // Sync Jobs
    const unsyncedJobs = await localDb.jobs.where('isSynced').equals(false).toArray();
    for (const job of unsyncedJobs) {
      console.log('Syncing job:', job);
      const { data, error } = await supabaseDb.from('jobs').upsert([job]);
      if (error || !data) {
        console.error('Error syncing job to Supabase:', error);
      } else {
        console.log('Job synced successfully:', data);
        await localDb.jobs.update(job.id!, { isSynced: true });
        console.log('Job marked as synced in local DB.');
      }
    }

    // Sync Pause Intervals
    const unsyncedPauseIntervals = await localDb.pause_intervals.where('isSynced').equals(false).toArray();
    for (const pauseInterval of unsyncedPauseIntervals) {
      console.log('Syncing pause interval:', pauseInterval);
      const { data, error } = await supabaseDb.from('pause_intervals').upsert([pauseInterval]);
      if (error || !data) {
        console.error('Error syncing pause interval to Supabase:', error);
      } else {
        console.log('Pause interval synced successfully:', data);
        await localDb.pause_intervals.update(pauseInterval.id!, { isSynced: true });
        console.log('Pause interval marked as synced in local DB.');
      }
    }

    // Sync Events
    const unsyncedEvents = await localDb.events.where('isSynced').equals(false).toArray();
    for (const event of unsyncedEvents) {
      console.log('Syncing event:', event);
      const { data, error } = await supabaseDb.from('events').upsert([event]);
      if (error || !data) {
        console.error('Error syncing event to Supabase:', error);
      } else {
        console.log('Event synced successfully:', data);
        await localDb.events.update(event.id!, { isSynced: true });
        console.log('Event marked as synced in local DB.');
      }
    }

    // Consider adding logic to sync other tables if necessary based on your schema
    // Example for Technicians (if technicians can be added/modified offline)
    // const unsyncedTechnicians = await localDb.technicians.where('isSynced').equals(false).toArray();
    // for (const technician of unsyncedTechnicians) {
    //   const { data, error } = await supabaseDb.from('technicians').upsert([technician]);
    //   if (error) console.error('Error syncing technician:', error);
    //   else await localDb.technicians.update(technician.id!, { isSynced: true });
    // }

  } catch (generalError) {
    console.error('An error occurred during synchronization:', generalError);
  }

  console.log('Local data synchronization process finished.');
}