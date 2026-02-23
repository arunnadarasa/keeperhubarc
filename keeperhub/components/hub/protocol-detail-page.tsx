"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ProtocolDefinition } from "@/keeperhub/lib/protocol-registry";

export function ProtocolDetailPage({
  protocol,
}: {
  protocol: ProtocolDefinition;
}): React.ReactElement {
  const router = useRouter();

  useEffect(() => {
    router.replace(`/hub?protocol=${protocol.slug}`);
  }, [router, protocol.slug]);

  return <div className="pointer-events-auto fixed inset-0 bg-sidebar" />;
}
