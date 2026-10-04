import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MeResponse } from "@bankforall/shared";
import { api, qk } from "@/api/endpoints";
import { sameAddress } from "@/lib/format";
import { clearPendingBackup, pendingBackup } from "@/wallet/device";

/**
 * After a key rotation executes (`me.walletAddress` becomes the key created on this device), uploads
 * the backup that was prepared with the new recovery code and wallet proof at request time.
 * Returns true while the upload is still needed; a failed upload is retried on the next load.
 */
export function usePendingBackupSync(me: MeResponse | null | undefined, local: string | null | undefined): boolean {
  const queryClient = useQueryClient();
  const pending = useQuery({ queryKey: ["pendingBackup"], queryFn: pendingBackup, staleTime: Infinity });
  const [failed, setFailed] = useState(false);
  const started = useRef(false);
  const p = pending.data;
  const needed = !!me && !!p && sameAddress(p.address, local) && sameAddress(me.walletAddress, p.address);

  useEffect(() => {
    if (!needed || !p || started.current) return;
    started.current = true;
    void (async () => {
      try {
        await api.registerWallet(p.address, p.proof, p.backup);
        await clearPendingBackup();
        await queryClient.invalidateQueries({ queryKey: ["pendingBackup"] });
        await queryClient.invalidateQueries({ queryKey: qk.me });
      } catch {
        setFailed(true);
      }
    })();
  }, [needed, p, queryClient]);

  return pending.isLoading || (needed && !failed);
}
