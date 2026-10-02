import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/api/client";
import { api, qk } from "@/api/endpoints";
import { localAddress } from "@/wallet/device";

export function useConfig() {
  return useQuery({ queryKey: qk.config, queryFn: api.config, staleTime: Infinity });
}

/** Current user; `data` is null when logged out (401). */
export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: async () => {
      try {
        return await api.me();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 15_000,
  });
}

/** Address of the key stored on this device (null if none). */
export function useLocalAddress() {
  return useQuery({ queryKey: ["localAddress"], queryFn: localAddress, staleTime: Infinity });
}
