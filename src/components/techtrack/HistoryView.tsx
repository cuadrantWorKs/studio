
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Workday, WorkdaySummaryContext } from '@/lib/techtrack/types';
import { calculateWorkdaySummary } from '@/lib/techtrack/summary';
import WorkdaySummaryDisplay from './WorkdaySummaryDisplay';
import { ArrowLeft, Loader2 } from 'lucide-react';

const LOCAL_STORAGE_KEY = 'TECHTRACK_WORKDAYS_HISTORY';

export default function HistoryView() {
  const [pastWorkdays, setPastWorkdays] = useState<Workday[]>([]);
  const [selectedWorkday, setSelectedWorkday] = useState<Workday | null>(null);
  const [displayedSummary, setDisplayedSummary] = useState<WorkdaySummaryContext | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);

  useEffect(() => {
    setIsLoadingHistory(true);
    try {
      const storedHistory = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (storedHistory) {
        const parsedHistory: Workday[] = JSON.parse(storedHistory);
        parsedHistory.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
        setPastWorkdays(parsedHistory);
      }
    } catch (error) {
      console.error("Error loading history from localStorage:", error);
    }
    setIsLoadingHistory(false);
  }, []);

  useEffect(() => {
    if (selectedWorkday) {
      setIsLoadingSummary(true);
      setDisplayedSummary(null); // Clear previous summary
      calculateWorkdaySummary(selectedWorkday)
        .then(summary => {
          setDisplayedSummary(summary);
        })
        .catch(error => {
          console.error("Error calculating summary for selected workday:", error);
          // Optionally set an error state to show in UI
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
        <p>Loading history...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen items-center p-4 bg-secondary/30">
      <Card className="w-full max-w-3xl shadow-xl my-8">
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="text-2xl">Workday History</CardTitle>
            <Link href="/" passHref legacyBehavior>
              <Button variant="outline" size="sm" asChild>
                <a><ArrowLeft className="mr-2 h-4 w-4" /> Back to Tracking</a>
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {pastWorkdays.length === 0 ? (
            <p className="text-muted-foreground">No past workdays found in history.</p>
          ) : (
            <div className="grid md:grid-cols-3 gap-6">
              <ScrollArea className="h-[60vh] md:col-span-1 pr-3">
                <div className="space-y-2">
                  {pastWorkdays.map((wd) => (
                    <Button
                      key={wd.id}
                      variant={selectedWorkday?.id === wd.id ? "default" : "outline"}
                      className="w-full justify-start"
                      onClick={() => handleSelectWorkday(wd)}
                    >
                      {new Date(wd.date).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}
                       {wd.startTime && ` (${new Date(wd.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`}
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
