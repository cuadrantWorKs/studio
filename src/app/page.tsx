'use client';

import React from 'react';

import TechTrackApp from '@/components/techtrack/TechTrackApp';
export default function Page() {
  // Pass the desired technician name via props:
  return <TechTrackApp technicianName="RICARDO" />;
}
