import { BrowserRouter as Router, Routes, Route, NavLink } from "react-router-dom";
import { Grid3X3, BookOpen, Upload, Scan } from "lucide-react";
import UploadPage from "./pages/UploadPage";
import CollagePage from "./pages/CollagePage";
import CustomizationPage from "./pages/CustomizationPage";
import LibraryPage from "./pages/LibraryPage";
import HelpMenu from "./components/HelpMenu";

export default function App() {
  const getNavLinkClass = ({ isActive }: { isActive: boolean }) => {
    const baseClass = "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150";
    return isActive
      ? `${baseClass} text-accent bg-accent/8 font-semibold border-b-2 border-accent rounded-b-none`
      : `${baseClass} text-muted hover:text-ink hover:bg-surface`;
  };

  return (
    <Router>
      <div className="min-h-screen bg-surface flex flex-col">
        {/* Top Navigation */}
        <nav className="bg-nav border-b border-border shadow-card sticky top-0 z-40 backdrop-blur-sm h-14 flex items-center px-4 gap-2 justify-between">
          <div className="flex items-center gap-6">
            {/* Brand Area */}
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 bg-gradient-to-br from-accent to-accent-sky rounded-lg flex items-center justify-center text-white shadow-btn">
                <Scan size={15} />
              </div>
            </div>

            {/* Navigation Links */}
            <div className="flex items-center gap-1.5">
              <NavLink to="/" className={getNavLinkClass}>
                <Upload size={15} />
                Upload
              </NavLink>
              <NavLink to="/library" className={getNavLinkClass}>
                <BookOpen size={15} />
                Library
              </NavLink>
              <NavLink to="/collage" className={getNavLinkClass}>
                <Grid3X3 size={15} />
                Collage
              </NavLink>
            </div>
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
          </Routes>
        </main>
      </div>
    </Router>
  );
}
