"use client";

import { useState, useEffect } from 'react';
import { localDb } from '@/db'; // Import local Dexie DB
import { syncLocalDataToSupabase } from '@/lib/techtrack/sync'; // Import sync function
import { Button } from '@/components/ui/button';
import type { Workday } from '@/lib/techtrack/types';

export default function HistoryPage() {
  const [workdays, setWorkdays] = useState<Workday[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  const fetchWorkdays = async () => {
    try {
      const allWorkdays = await localDb.workdays.toArray();
      setWorkdays(allWorkdays);
    } catch (error) {
      console.error("Error fetching workdays from local DB:", error);
      // TODO: Handle error (e.g., show a toast)
    }
  };

  useEffect(() => {
    fetchWorkdays();
  }, []);

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      await syncLocalDataToSupabase();
      await fetchWorkdays(); // Refetch data after sync
    } catch (error) {
      console.error("Error syncing local data:", error);
      // TODO: Handle error (e.g., show a toast)
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Historial de Jornadas Laborales</h1>
      <Button onClick={handleManualSync} disabled={isSyncing}>
        {isSyncing ? 'Sincronizando...' : 'Sincronizar Ahora'}
      </Button>
      {/* Display the list of workdays here */}
      <ul>
        {workdays.map(workday => (
          <li key={workday.id} className="border p-2 mb-2 rounded-md shadow-sm">
            <h3 className="text-lg font-semibold">Jornada ID: {workday.id}</h3>
            {/* Add more details as needed */}
            {workday.startTime && <p>Inicio: {new Date(workday.startTime).toLocaleString()}</p>}
            {workday.endTime && <p>Fin: {workday.endTime ? new Date(workday.endTime).toLocaleString() : 'In Progress'}</p>}
            <p>Sincronizado: {workday.isSynced ? 'Sí' : 'No'}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
