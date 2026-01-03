'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Workday, WorkdaySummaryContext } from '@/lib/techtrack/types';
import { calculateWorkdaySummary } from '@/lib/techtrack/summary';
import WorkdaySummaryDisplay from './WorkdaySummaryDisplay';
import { ArrowLeft, Loader2, AlertTriangle } from 'lucide-react';
import { db } from '@/lib/supabase';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import WorkdayTimeline from "./WorkdayTimeline";
import RawDataInspector from "./RawDataInspector";
import dynamic from 'next/dynamic';

const WorkdayMap = dynamic(() => import('./WorkdayMap'), {
  ssr: false,
  loading: () => <div className="h-[500px] w-full flex items-center justify-center bg-slate-100 rounded-lg animate-pulse">Loading Map...</div>
});

export default function HistoryView() {
  const [pastWorkdays, setPastWorkdays] = useState<Workday[]>([]);
  const [selectedWorkday, setSelectedWorkday] = useState<Workday | null>(null);
  const [displayedSummary, setDisplayedSummary] = useState<WorkdaySummaryContext | null>(null);
  const [fullWorkdayDetails, setFullWorkdayDetails] = useState<Workday | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchHistory = async () => {
      setIsLoadingHistory(true);
      setError(null);
      try {
        const { data, error } = await db
          .from('workdays')
          .select('*')
          .order('start_time', { ascending: false });

        if (error) throw error;

        // Transform Supabase data to Workday type
        // Note: This is a simplified transformation. In a real app, you'd need to fetch related jobs, events, etc.
        // or use a join query if the summary calculation needs them.
        // For now, we'll assume the summary calculation might need more data, so we might need to fetch full details
        // when a workday is selected.

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fetchedWorkdays: Workday[] = (data || []).map((row: any) => ({
          id: row.id,
          userId: row.user_id,
          date: row.date,
          startTime: row.start_time,
          endTime: row.end_time,
          status: row.status,
          // Map other fields as needed, defaulting arrays to empty for the list view
          jobs: [],
          events: [],
          pauseIntervals: [],
          locationHistory: [],
          startLocation: row.start_location_latitude ? {
            latitude: row.start_location_latitude,
            longitude: row.start_location_longitude,
            timestamp: row.start_location_timestamp || 0
          } : undefined,
          endLocation: row.end_location_latitude ? {
            latitude: row.end_location_latitude,
            longitude: row.end_location_longitude,
            timestamp: row.end_location_timestamp || 0
          } : undefined
        } as Workday));

        setPastWorkdays(fetchedWorkdays);
      } catch (err) {
        console.error("Error fetching history from Supabase:", err);
        setError("Failed to load history. Please check your Supabase setup and network connection.");
      } finally {
        setIsLoadingHistory(false);
      }
    };

    fetchHistory();
  }, []);

  useEffect(() => {
    if (selectedWorkday) {
      setIsLoadingSummary(true);
      setDisplayedSummary(null);

      // We need to fetch the full details for the selected workday to calculate the summary
      const fetchFullWorkdayDetails = async (workdayId: string) => {
        const { data: jobs } = await db.from('jobs').select('*').eq('workday_id', workdayId);
        const { data: pauses } = await db.from('pause_intervals').select('*').eq('workday_id', workdayId);
        const { data: events } = await db.from('events').select('*').eq('workday_id', workdayId);
        const { data: locations } = await db.from('locations').select('*').eq('workday_id', workdayId);

        const fullWorkday: Workday = {
          ...selectedWorkday,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          jobs: (jobs || []).map((j: any) => ({
            id: j.id,
            description: j.description,
            startTime: j.start_time,
            endTime: j.end_time,
            status: j.status,
            summary: j.summary,
            aiSummary: j.ai_summary,
            startLocation: { latitude: j.start_location_latitude, longitude: j.start_location_longitude, timestamp: j.start_location_timestamp },
            endLocation: j.end_location_latitude ? { latitude: j.end_location_latitude, longitude: j.end_location_longitude, timestamp: j.end_location_timestamp } : undefined
          })),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          pauseIntervals: (pauses || []).map((p: any) => ({
            id: p.id,
            startTime: p.start_time,
            endTime: p.end_time,
            startLocation: p.start_location_latitude ? { latitude: p.start_location_latitude, longitude: p.start_location_longitude, timestamp: p.start_location_timestamp } : undefined,
            endLocation: p.end_location_latitude ? { latitude: p.end_location_latitude, longitude: p.end_location_longitude, timestamp: p.end_location_timestamp } : undefined
          })),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          events: (events || []).map((e: any) => ({
            id: e.id,
            type: e.type,
            timestamp: e.timestamp,
            jobId: e.job_id,
            details: e.details,
            location: e.location_latitude ? { latitude: e.location_latitude, longitude: e.location_longitude, timestamp: e.location_timestamp } : undefined
          })),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          locationHistory: (locations || []).map((l: any) => ({
            latitude: l.latitude,
            longitude: l.longitude,
            timestamp: l.timestamp,
            accuracy: l.accuracy
          }))
        };
        return fullWorkday;
      };

      fetchFullWorkdayDetails(selectedWorkday.id)
        .then(fullWorkday => {
          setFullWorkdayDetails(fullWorkday);
          return calculateWorkdaySummary(fullWorkday);
        })
        .then(summary => {
          setDisplayedSummary(summary);
        })
        .catch(error => {
          console.error("Error calculating summary for selected workday:", error);
          setError("Failed to calculate summary for the selected workday.");
        })
        .finally(() => {
          setIsLoadingSummary(false);
        });
    } else {
      setDisplayedSummary(null);
    }
  }, [selectedWorkday]);

  const handleSelectWorkday = (workday: Workday) => {
    setSelectedWorkday(workday);
  };

  if (isLoadingHistory) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Loader2 className="mr-2 h-8 w-8 animate-spin" />
        <p>Loading history from cloud...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center p-4 text-center">
        <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
        <p className="text-destructive text-xl mb-2">Error Loading History</p>
        <p className="text-muted-foreground mb-4">{error}</p>
        <Button variant="outline" asChild>
          <Link href="/">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Tracking
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen items-center p-4 bg-secondary/30">
      <Card className="w-full max-w-3xl shadow-xl my-8">
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="text-2xl">Workday History (Cloud)</CardTitle>
            <Button variant="outline" size="sm" asChild>
              <Link href="/">
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to Tracking
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {pastWorkdays.length === 0 ? (
            <p className="text-muted-foreground">No past workdays found in the cloud.</p>
          ) : (
            <div className="grid md:grid-cols-3 gap-6">
              <ScrollArea className="h-[60vh] md:col-span-1 pr-3">
                <div className="space-y-2">
                  {pastWorkdays.map((wd) => (
                    <Button
                      key={wd.id}
                      variant={selectedWorkday?.id === wd.id ? "default" : "outline"}
                      className="w-full justify-start text-left h-auto py-2"
                      onClick={() => handleSelectWorkday(wd)}
                    >
                      <div className="flex flex-col">
                        <span>
                          {wd.date ? new Date(wd.date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'Date N/A'}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {wd.startTime ? `Started: ${new Date(wd.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Start Time N/A'}
                        </span>
                      </div>
                    </Button>
                  ))}
                </div>
              </ScrollArea>
              <div className="md:col-span-2">
                {isLoadingSummary ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                    <p className="text-muted-foreground">Loading summary...</p>
                  </div>
                ) : displayedSummary && fullWorkdayDetails ? (
                  <Tabs defaultValue="summary" className="w-full">
                    <TabsList className="grid w-full grid-cols-4">
                      <TabsTrigger value="summary">Summary</TabsTrigger>
                      <TabsTrigger value="map">Map</TabsTrigger>
                      <TabsTrigger value="timeline">Timeline</TabsTrigger>
                      <TabsTrigger value="raw">Data</TabsTrigger>
                    </TabsList>

                    <TabsContent value="summary" className="mt-4">
                      <WorkdaySummaryDisplay summary={displayedSummary} showTitle={false} />
                    </TabsContent>

                    <TabsContent value="map" className="mt-4">
                      <WorkdayMap workday={fullWorkdayDetails} />
                    </TabsContent>

                    <TabsContent value="timeline" className="mt-4">
                      <WorkdayTimeline events={fullWorkdayDetails.events} />
                    </TabsContent>

                    <TabsContent value="raw" className="mt-4">
                      <RawDataInspector workday={fullWorkdayDetails} />
                    </TabsContent>
                  </Tabs>
                ) : (
                  <p className="text-muted-foreground h-full flex items-center justify-center">
                    Select a workday from the list to view details.
                  </p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
