'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { History, User, PlayCircle } from 'lucide-react';

interface TechnicianSelectionProps {
  onTechnicianSelect: (technicianName: string) => void;
}

const technicians = [
  { id: 'ricardo-iphone', name: 'RICARDO' },
  { id: 'rodrigo-nxt', name: 'RODRIGO' }
];

export default function TechnicianSelection({ onTechnicianSelect }: TechnicianSelectionProps) {
  const [selectedTechnician, setSelectedTechnician] = useState<string>(technicians[0].id);

  const handleContinue = () => {
    onTechnicianSelect(selectedTechnician);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-secondary/30">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center">
          <User className="mx-auto h-16 w-16 text-primary mb-4" />
          <CardTitle className="text-3xl font-bold text-primary">Bienvenido a TechTrack</CardTitle>
          <CardDescription>Seleccione su perfil para iniciar la jornada.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-2">
          <div className="space-y-2">
            <label htmlFor="technician-select" className="text-sm font-medium text-foreground">
              Técnico
            </label>
            <Select value={selectedTechnician} onValueChange={setSelectedTechnician}>
              <SelectTrigger id="technician-select" className="w-full">
                <div className="flex items-center">
                  <User className="mr-2 h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder="Seleccione un técnico" />
                </div>
              </SelectTrigger>
              <SelectContent>
                {technicians.map((tech) => (
                  <SelectItem key={tech.id} value={tech.id}>
                    {tech.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button onClick={handleContinue} className="w-full" size="lg">
            <PlayCircle className="mr-2 h-5 w-5" />
            Continuar como {selectedTechnician}
          </Button>
        </CardContent>
        <CardFooter className="flex justify-center pt-4">
          <Button variant="outline" size="sm" asChild>
            <Link href="/history">
              <History className="mr-2 h-4 w-4" /> Consultar historial de la empresa
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
