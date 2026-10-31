"use client";

import { useEffect } from "react";
import { initializeRum, type RumConfiguration } from "../utils/rum";

export default function RumClient({
  configuration,
}: {
  configuration: RumConfiguration;
}) {
  useEffect(() => {
    initializeRum(configuration);
  }, [configuration]);

  return null;
}
