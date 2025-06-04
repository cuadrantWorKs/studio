import React from "react";
import { Job } from "@/lib/techtrack/types";

export interface CurrentStatusDisplayProps {
  status: "tracking" | "paused";
  currentJob: Job | null;
  aiLoading: Record<string, boolean>;
}

const CurrentStatusDisplay: React.FC<CurrentStatusDisplayProps> = ({
  status,
  currentJob,
  aiLoading,
}) => {
  return <div>Current Status Display</div>;
};



export default CurrentStatusDisplay;
