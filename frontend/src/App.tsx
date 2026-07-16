import { createBrowserRouter, RouterProvider, NavLink, useBlocker, Outlet } from "react-router-dom";
import { Grid3X3, Bookmark, Upload, Images } from "lucide-react";
import UploadPage from "./pages/UploadPage";
import CollagePage from "./pages/CollagePage";
import CustomizationPage from "./pages/CustomizationPage";
import LibraryPage from "./pages/LibraryPage";
import SavedPage from "./pages/SavedPage";
import { UploadProvider } from "./context/UploadContext";
import { loadCustomSubcategories } from "./config/categories";
import { GenerationService } from "./lib/generationService";
import { useEffect, useState } from "react";

// Register Service Worker for offline support and image caching
export function registerServiceWorker() {
  // Skip service worker registration in development mode to avoid 404 errors
  if (import.meta.env.DEV) {
    console.log('[App] Skipping Service Worker registration in development mode');
    return;
  }
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          console.log('[App] Service Worker registered:', registration.scope);
        })
        .catch((error) => {
          console.error('[App] Service Worker registration failed:', error.message || error);
        });
    });
  }
}

function NavigationGuard() {
  const [showDialog, setShowDialog] = useState(false);
  const [pendingLocation, setPendingLocation] = useState<string | null>(null);
  
  // Block navigation when there are generated results and user is on collage page
  const blocker = useBlocker(() => {
    const hasResults = GenerationService.hasGeneratedResults();
    const isOnCollagePage = window.location.pathname.startsWith("/collage");
    return hasResults && isOnCollagePage;
  });

  useEffect(() => {
    if (blocker.state === "blocked") {
      setShowDialog(true);
      setPendingLocation(blocker.location.pathname);
    }
  }, [blocker.state, blocker.location]);

  const handleDiscard = () => {
    GenerationService.clear();
    setShowDialog(false);
    if (pendingLocation) {
      (blocker as any).proceed();
    }
  };

  const handleCancel = () => {
    setShowDialog(false);
    setPendingLocation(null);
    (blocker as any).reset();
  };

  if (!showDialog) return null;

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative z-[100000] w-full max-w-md bg-white rounded-2xl shadow-2xl border border-border p-6">
        <h3 className="text-lg font-bold text-ink mb-2">Unsaved Combinations</h3>
        <p className="text-sm text-muted mb-6">
          You have generated combinations that haven't been saved. If you leave this page, they will be discarded.
        </p>
        <div className="flex gap-3">
          <button
            onClick={handleDiscard}
            className="flex-1 px-4 py-2.5 rounded-xl bg-rose-600 text-white font-semibold text-sm hover:bg-rose-700 transition-all cursor-pointer"
          >
            Discard & Leave
          </button>
          <button
            onClick={handleCancel}
            className="flex-1 px-4 py-2.5 rounded-xl bg-panel border border-border text-ink font-semibold text-sm hover:bg-surface transition-all cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function AppLayout() {
  const getNavLinkClass = ({ isActive }: { isActive: boolean }) => {
    const baseClass = "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150";
    return isActive
      ? `${baseClass} text-accent bg-accent/8 font-semibold border-b-2 border-accent rounded-b-none`
      : `${baseClass} text-muted hover:text-ink hover:bg-surface`;
  };

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <NavigationGuard />
      {/* Top Navigation */}
      <nav className="bg-nav border-b border-border shadow-card sticky top-0 z-40 backdrop-blur-sm h-14 flex items-center px-4 gap-2 justify-between">
        <div className="flex items-center gap-1.5">
          <NavLink to="/" className={getNavLinkClass}>
            <Upload size={15} />
            Upload
          </NavLink>
          <NavLink to="/library" className={getNavLinkClass}>
            <Images size={15} />
            Library
          </NavLink>
          <NavLink to="/collage" className={getNavLinkClass}>
            <Grid3X3 size={15} />
            Collage
          </NavLink>
          <NavLink to="/saved" className={getNavLinkClass}>
            <Bookmark size={15} />
            Saved
          </NavLink>
        </div>
        </nav>

      {/* Main Content */}
      <main className="flex-1 flex flex-col">
        <Outlet />
      </main>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: "/", element: <UploadPage /> },
      { path: "/library", element: <LibraryPage /> },
      { path: "/collage", element: <CollagePage /> },
      { path: "/customize", element: <CustomizationPage /> },
      { path: "/saved", element: <SavedPage /> },
    ],
  },
]);

export default function App() {
  useEffect(() => {
    loadCustomSubcategories();
    registerServiceWorker();
  }, []);

  return (
    <UploadProvider>
      <RouterProvider router={router} />
    </UploadProvider>
  );
}
