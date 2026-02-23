"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ProtocolDefinition } from "@/keeperhub/lib/protocol-registry";
import { ProtocolDetail } from "./protocol-detail";

type ProtocolDetailModalProps = {
  protocol: ProtocolDefinition | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ProtocolDetailModal({
  protocol,
  open,
  onOpenChange,
}: ProtocolDetailModalProps): React.ReactElement {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-4xl">
        <DialogTitle className="sr-only">
          {protocol?.name ?? "Protocol Details"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {protocol?.description ?? "Protocol actions and details"}
        </DialogDescription>
        {protocol && <ProtocolDetail hideBackButton protocol={protocol} />}
      </DialogContent>
    </Dialog>
  );
}
