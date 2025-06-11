
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Workday, WorkdaySummaryContext } from '@/lib/techtrack/types';
import { calculateWorkdaySummary } from '@/lib/techtrack/summary';
import WorkdaySummaryDisplay from './WorkdaySummaryDisplay';
import { ArrowLeft, Loader2, AlertTriangle } from 'lucide-react'; // Added AlertTriangle
import { toCamelCase } from '@/lib/utils';
import { db } from '@/lib/supabase';




export default function HistoryView() {
  const [pastWorkdays, setPastWorkdays] = useState<Workday[]>([]);
  const [selectedWorkday, setSelectedWorkday] = useState<Workday | null>(null);
  const [displayedSummary, setDisplayedSummary] = useState<WorkdaySummaryContext | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchHistory = async () => {
      setIsLoadingHistory(true);
      setError(null);
      try {
const {data: workdays, error} = await db
  .from('workdays')
  .select(`
    *,
    jobs (*),
    locationHistory:locations (*),
    pause_intervals (*)
  `)
  .order('start_time', {ascending: false});

        if (error) {
          console.log('Error fetching supabase workdays:', error);
        }else{
          console.log('Workdays fetched with SUPABASE:', workdays);
          const fetchedWorkdays: Workday[] = toCamelCase(workdays) || [];
          setPastWorkdays(fetchedWorkdays);
        }
        /*const workdaysCollectionRef = collection(db, "workdays");
        const q = query(workdaysCollectionRef, orderBy("startTime", "desc"));
        const querySnapshot = await getDocs(q);*/
        
      } catch (err) {
        console.error("Error fetching history from SUPABASE:", err);
        setError("Failed to load history. Please check your SUPABASE setup and network connection.");
      } finally {
        setIsLoadingHistory(false);
      }
    };

    fetchHistory();
  }, []);

  useEffect(() => {
    if (selectedWorkday) {
      console.log('selected workday', selectedWorkday);


      setIsLoadingSummary(true);
      setDisplayedSummary(null); 
      calculateWorkdaySummary(selectedWorkday)
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
        <AlertTriangle className="h-12 w-12 text-destructive mb-4" /> {/* Added Icon */}
        <p className="text-destructive text-xl mb-2">Error Loading History</p>
        <p className="text-muted-foreground mb-4">{error}</p>
        <Link href="/" passHref legacyBehavior>
            <Button variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to Tracking
            </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen items-center p-4 bg-secondary/30">
      <Card className="w-full max-w-3xl shadow-xl my-8">
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="text-2xl">Workday History (Cloud)</CardTitle>
            <Link href="/" passHref legacyBehavior>
              <Button variant="outline" size="sm" asChild>
                <a><ArrowLeft className="mr-2 h-4 w-4" /> Back to Tracking</a>
              </Button>
            </Link>
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
                ) : displayedSummary ? (
                  <WorkdaySummaryDisplay summary={displayedSummary} showTitle={false} />
                ) : (
                  <p className="text-muted-foreground h-full flex items-center justify-center">
                    Select a workday from the list to view its summary.
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

