import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import LoginPage from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import JoinPage from "@/pages/join";
import CameraPage from "@/pages/camera";
import BroadcastPage from "@/pages/broadcast";
import GatewayPaymentPage from "@/pages/gateway-payment";
import NotFound from "@/pages/not-found";
import { Loader2 } from "lucide-react";

function AuthenticatedRouter() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (window.location.pathname.startsWith("/gateway-payment")) {
    return <GatewayPaymentPage />;
  }

  if (window.location.pathname.startsWith("/join")) {
    return <JoinPage />;
  }

  if (window.location.pathname.startsWith("/camera/")) {
    return <CameraPage />;
  }

  if (window.location.pathname.startsWith("/broadcast")) {
    return <BroadcastPage />;
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/join" component={JoinPage} />
      <Route path="/camera/:token" component={CameraPage} />
      <Route path="/broadcast" component={BroadcastPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AuthenticatedRouter />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
