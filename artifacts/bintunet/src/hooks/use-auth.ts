import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

export function useAuth() {
  const { data: user, isLoading } = useQuery<{ authenticated: boolean } | null>({
    queryKey: ["/api/auth/check"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/auth/check", { credentials: "include" });
        if (res.status === 401) return { authenticated: false };
        return await res.json();
      } catch {
        return { authenticated: false };
      }
    },
    staleTime: 30000,
  });

  const loginMutation = useMutation({
    mutationFn: async (password: string) => {
      const res = await apiRequest("POST", "/api/auth/login", { password });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/check"] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/check"] });
    },
  });

  return {
    isAuthenticated: user?.authenticated ?? false,
    isLoading,
    login: loginMutation.mutateAsync,
    loginError: loginMutation.error,
    isLoggingIn: loginMutation.isPending,
    logout: logoutMutation.mutateAsync,
  };
}
