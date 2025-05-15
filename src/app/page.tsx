'use client';

import { useState } from 'react';
import TechTrackApp from '@/components/techtrack/TechTrackApp';
import TechnicianSelection from '@/components/techtrack/TechnicianSelection';

export default function HomePage() {
  const [selectedTechnicianName, setSelectedTechnicianName] = useState<string | null>(null);

  const handleTechnicianSelected = (name: string) => {
    setSelectedTechnicianName(name);
  };

  if (!selectedTechnicianName) {
    return <TechnicianSelection onTechnicianSelect={handleTechnicianSelected} />;
  }

  return <TechTrackApp technicianName={selectedTechnicianName} />;
}
