import { BrowserRouter as Router, Routes, Route, NavLink } from "react-router-dom";
import { Grid3X3, Bookmark, Upload, Images } from "lucide-react";
import UploadPage from "./pages/UploadPage";
import CollagePage from "./pages/CollagePage";
import CustomizationPage from "./pages/CustomizationPage";
import LibraryPage from "./pages/LibraryPage";
import SavedPage from "./pages/SavedPage";
import HelpMenu from "./components/common/HelpMenu";
import { UploadProvider } from "./context/UploadContext";
import { loadCustomSubcategories } from "./config/categories";
import { useEffect } from "react";

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

export default function App() {
  useEffect(() => {
    loadCustomSubcategories();
    registerServiceWorker();
  }, []);
  const getNavLinkClass = ({ isActive }: { isActive: boolean }) => {
    const baseClass = "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150";
    return isActive
      ? `${baseClass} text-accent bg-accent/8 font-semibold border-b-2 border-accent rounded-b-none`
      : `${baseClass} text-muted hover:text-ink hover:bg-surface`;
  };

  return (
    <UploadProvider>
    <Router>
      <div className="min-h-screen bg-surface flex flex-col">
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
          <HelpMenu />
        </nav>

        {/* Main Content */}
        <main className="flex-1 flex flex-col">
          <Routes>
            <Route path="/" element={<UploadPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/collage" element={<CollagePage />} />
            <Route path="/customize" element={<CustomizationPage />} />
            <Route path="/saved" element={<SavedPage />} />
          </Routes>
        </main>
      </div>
    </Router>
    </UploadProvider>
  );
}
