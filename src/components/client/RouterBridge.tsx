"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { registerRouter } from "@/lib/client/navigation";

// useRouter の値を端末側の action へ渡す (lib/client/navigation.ts)。
// 根の layout に 1 つだけ置く。描くものは無い
export function RouterBridge() {
  const router = useRouter();
  useEffect(() => {
    registerRouter(router);
    return () => registerRouter(null);
  }, [router]);
  return null;
}
