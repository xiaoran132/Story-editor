import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Community from "./pages/Community";
import PlayerExperience from "./pages/PlayerExperience";
import CreatorEditor from "./pages/CreatorEditor";
import Monetization from "./pages/Monetization";
import Header from "./components/Header";

const queryClient = new QueryClient();

const App = () => {
  console.log("AI Story Platform Initialized");
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="min-h-screen flex flex-col relative overflow-hidden">
          {/* Global Ambient Glows */}
          <div className="fixed top-0 left-1/4 w-[500px] h-[500px] bg-[rgba(168,85,247,0.15)] rounded-full blur-[120px] pointer-events-none -z-10" />
          <div className="fixed bottom-0 right-1/4 w-[600px] h-[600px] bg-[rgba(56,189,248,0.1)] rounded-full blur-[150px] pointer-events-none -z-10" />
          
          <Header />
          <main className="flex-1 w-full relative z-0">
            <Routes>
              <Route path="/" element={<Community />} />
              <Route path="/play" element={<PlayerExperience />} />
              <Route path="/editor" element={<CreatorEditor />} />
              <Route path="/dashboard" element={<Monetization />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  );
};

export default App;