import React, { useState } from "react";
import { 
  HelpCircle, X, ChevronRight, Upload, Grid, Settings, 
  Layers, BookOpen, Award, FileText, MousePointer, Keyboard,
  PenTool, Square, Circle, ZoomIn
} from "lucide-react";

export default function HelpMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string>("beer-lambert");

  const sections = [
    {
      id: "beer-lambert",
      title: "Beer–Lambert Law",
      icon: <Award size={16} />,
      content: (
        <div className="space-y-4 animate-fade-in">
          <h4 className="text-lg font-bold text-ink">Grayscale Gradients & Beer–Lambert</h4>
          <p className="text-sm text-muted leading-relaxed">
            In X-ray imaging, when radiation passes through stacked materials, the remaining intensity is determined by the materials' densities and thicknesses. We model this multiplicative attenuation behavior using a simplified digital approximation.
          </p>
          <div className="bg-sky-50 border border-sky-200 text-sky-800 rounded-xl p-4 text-sm">
            <span className="font-bold">▎ Multiplicative Absorption</span>
            <p className="mt-1">
              Since X-ray values represent transparency (where white is air/65535 and black is total absorption/0), stacking two materials results in a compounding reduction in brightness.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4 text-center font-mono text-base text-ink">
            Synthesized Pixel = (I₁ × I₂) / 65535
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="bg-surface border border-border rounded-xl p-3 hover:border-accent/30 transition-colors">
              <p className="text-xs font-semibold text-ink mb-1">I₁ & I₂</p>
              <p className="text-xs text-muted leading-relaxed">Original pixel values of the two overlapping objects (e.g. Duffel bag and Heating Coil).</p>
            </div>
            <div className="bg-surface border border-border rounded-xl p-3 hover:border-accent/30 transition-colors">
              <p className="text-xs font-semibold text-ink mb-1">65535</p>
              <p className="text-xs text-muted leading-relaxed">The maximum possible pixel intensity corresponding to pure white (representing background air space).</p>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "upload",
      title: "Upload",
      icon: <Upload size={16} />,
      content: (
        <div className="space-y-4 animate-fade-in">
          <h4 className="text-lg font-bold text-ink">Uploading Custom Scanned Bags</h4>
          <p className="text-sm text-muted leading-relaxed">
            You can upload bulk grayscale PNG images directly from your computer to add them to your local libraries.
          </p>
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 text-sm">
            <span className="font-bold">▎ Important: Filename Naming Standard</span>
            <p className="mt-1">
              Filenames must start with the category prefix followed by an underscore (e.g., <code className="font-mono text-xs bg-panel px-1.5 py-0.5 rounded border border-border">bag_suitcase.png</code>, <code className="font-mono text-xs bg-panel px-1.5 py-0.5 rounded border border-border">threat_gun.png</code>). This prefix tells the database which library the object belongs to.
            </p>
          </div>
          <div className="space-y-2">
            <h5 className="text-xs font-semibold text-ink uppercase tracking-wider">File Requirements</h5>
            <ul className="text-xs text-muted list-disc list-inside space-y-1">
              <li>Format: Grayscale PNG files only.</li>
              <li>Sizing: Preferably 512×512 or square dimensions for optimal preview.</li>
              <li>Grayscale range: 0 (pure black) to 65535 (pure white).</li>
            </ul>
          </div>
        </div>
      ),
    },
    {
      id: "library",
      title: "Library",
      icon: <BookOpen size={16} />,
      content: (
        <div className="space-y-4 animate-fade-in">
          <h4 className="text-lg font-bold text-ink">Scanned Bags Library & Categories</h4>
          <p className="text-sm text-muted leading-relaxed">
            Browse all uploaded scanned bags organized dynamically by category. You can perform multi-selection across categories to bundle objects for collages.
          </p>
          <div className="bg-sky-50 border border-sky-200 text-sky-800 rounded-xl p-4 text-sm">
            <span className="font-bold">▎ Library Sidebar navigation</span>
            <p className="mt-1">
              Select category groups from the left pane to focus on relevant objects. Filter further using subcategory chips at the top of the item grid.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="bg-surface border border-border rounded-xl p-3 hover:border-accent/30 transition-colors">
              <p className="text-xs font-semibold text-ink mb-1">Search & Toggle</p>
              <p className="text-xs text-muted leading-relaxed">Quickly filter items within a category by typing keywords or toggle between grid and list views.</p>
            </div>
            <div className="bg-surface border border-border rounded-xl p-3 hover:border-accent/30 transition-colors">
              <p className="text-xs font-semibold text-ink mb-1">Valid Region Trigger</p>
              <p className="text-xs text-muted leading-relaxed">On "Bags" category cards, click the mini Edit icon to open the custom Valid Placement Region Editor.</p>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "collage",
      title: "Collage",
      icon: <Grid size={16} />,
      content: (
        <div className="space-y-4 animate-fade-in">
          <h4 className="text-lg font-bold text-ink">Collage Generator</h4>
          <p className="text-sm text-muted leading-relaxed">
            Pre-generated bag and item combinations show in a responsive card grid to preview compound X-ray scans.
          </p>
          <div className="bg-sky-50 border border-sky-200 text-sky-800 rounded-xl p-4 text-sm">
            <span className="font-bold">▎ Clean vs Threat Flags</span>
            <p className="mt-1">
              Collages containing items classified in the threats database automatically get tagged with a red "Threat" badge. Clean collages show a green "Clean" badge.
            </p>
          </div>
          <p className="text-xs text-muted leading-relaxed">
            Clicking on any collage card automatically routes you to the Customization Workspace with those exact bag, threat, and clothing scanned bags loaded on the canvas.
          </p>
        </div>
      ),
    },
    {
      id: "valid-region",
      title: "Valid Region Editor",
      icon: <Layers size={16} />,
      content: (
        <div className="space-y-4 animate-fade-in">
          <h4 className="text-lg font-bold text-ink">Valid Placement Region Editor</h4>
          <p className="text-sm text-muted leading-relaxed">
            To make synthetic scans realistic, scanned bags (like electronics or threats) must not float outside the bag's container walls. The Valid Placement Region specifies the boundary of the bag cavity where objects can be placed.
          </p>

          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 text-sm">
            <span className="font-bold">▎ Drawing Tools</span>
            <p className="mt-1">Use the toolbar on the left to switch between drawing modes. Each shape can be set to Add (green) or Remove (red) mode to build up or carve out the valid region.</p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-surface border border-border rounded-xl p-3 hover:border-accent/30 transition-colors">
              <div className="flex items-center gap-1.5 mb-1">
                <MousePointer size={13} className="text-accent" />
                <p className="text-xs font-semibold text-ink">Select (V)</p>
              </div>
              <p className="text-xs text-muted leading-relaxed">Click to select existing shapes. Drag to move them. Drag corner handles to resize.</p>
            </div>
            <div className="bg-surface border border-border rounded-xl p-3 hover:border-accent/30 transition-colors">
              <div className="flex items-center gap-1.5 mb-1">
                <Square size={13} className="text-accent" />
                <p className="text-xs font-semibold text-ink">Rectangle (R)</p>
              </div>
              <p className="text-xs text-muted leading-relaxed">Click and drag to draw axis-aligned rectangles. Fast for defining main bag body.</p>
            </div>
            <div className="bg-surface border border-border rounded-xl p-3 hover:border-accent/30 transition-colors">
              <div className="flex items-center gap-1.5 mb-1">
                <Circle size={13} className="text-accent" />
                <p className="text-xs font-semibold text-ink">Circle (C)</p>
              </div>
              <p className="text-xs text-muted leading-relaxed">Click and drag to draw ellipses. Useful for rounded bags or circular pockets.</p>
            </div>
            <div className="bg-surface border border-border rounded-xl p-3 hover:border-accent/30 transition-colors">
              <div className="flex items-center gap-1.5 mb-1">
                <PenTool size={13} className="text-accent" />
                <p className="text-xs font-semibold text-ink">Polygon (P)</p>
              </div>
              <p className="text-xs text-muted leading-relaxed">Click to place vertices one by one. Double-click the first vertex or press Enter to close the polygon.</p>
            </div>
            <div className="bg-surface border border-border rounded-xl p-3 hover:border-accent/30 transition-colors">
              <div className="flex items-center gap-1.5 mb-1">
                <ZoomIn size={13} className="text-accent" />
                <p className="text-xs font-semibold text-ink">Zoom & Pan</p>
              </div>
              <p className="text-xs text-muted leading-relaxed">Scroll wheel to zoom in/out. Hold Space + drag to pan. Use toolbar buttons for fit/reset.</p>
            </div>
            <div className="bg-surface border border-border rounded-xl p-3 hover:border-accent/30 transition-colors">
              <div className="flex items-center gap-1.5 mb-1">
                <Layers size={13} className="text-accent" />
                <p className="text-xs font-semibold text-ink">Layers Panel</p>
              </div>
              <p className="text-xs text-muted leading-relaxed">Toggle shape visibility, reorder layers, and delete shapes from the collapsible layers sidebar.</p>
            </div>
          </div>

          <div className="bg-sky-50 border border-sky-200 text-sky-800 rounded-xl p-4 text-sm">
            <span className="font-bold">▎ Add vs Remove Mode</span>
            <p className="mt-1">Combine <strong>Add</strong> shapes (defines where items CAN be placed) with <strong>Remove</strong> shapes (punches holes — e.g. handles, frames, solid pockets) to build precise, realistic bag boundaries.</p>
          </div>

          <div className="bg-surface border border-border rounded-xl p-4 text-sm">
            <span className="font-bold text-ink">▎ Vertex Editing</span>
            <p className="mt-1 text-muted">In Select mode, click a polygon to reveal its vertices as draggable blue dots. Drag any vertex to reshape the polygon precisely.</p>
          </div>
        </div>
      ),
    },
    {
      id: "valid-region-hotkeys",
      title: "Editor Hotkeys",
      icon: <Keyboard size={16} />,
      content: (
        <div className="space-y-4 animate-fade-in">
          <h4 className="text-lg font-bold text-ink">Valid Region Editor — Keyboard Shortcuts</h4>
          <p className="text-sm text-muted leading-relaxed">
            Use these shortcuts to work faster in the Valid Region Editor without switching away from the keyboard.
          </p>

          <div className="space-y-1">
            <p className="text-xs font-semibold text-ink uppercase tracking-wider mb-2">Tool Selection</p>
            {[
              { key: "V", desc: "Switch to Select / Move tool" },
              { key: "R", desc: "Switch to Rectangle drawing tool" },
              { key: "C", desc: "Switch to Circle drawing tool" },
              { key: "P", desc: "Switch to Polygon drawing tool" },
            ].map(({ key, desc }) => (
              <div key={key} className="bg-panel rounded-xl border border-border px-3 py-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-ink">{desc}</span>
                <kbd className="text-xs text-accent font-mono bg-surface px-2 py-0.5 rounded border border-accent/30">{key}</kbd>
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <p className="text-xs font-semibold text-ink uppercase tracking-wider mb-2">History</p>
            {[
              { key: "Ctrl + Z", desc: "Undo last action" },
              { key: "Ctrl + Y", desc: "Redo last undone action" },
              { key: "Ctrl + Shift + Z", desc: "Redo (alternative)" },
            ].map(({ key, desc }) => (
              <div key={key} className="bg-panel rounded-xl border border-border px-3 py-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-ink">{desc}</span>
                <kbd className="text-xs text-accent font-mono bg-surface px-2 py-0.5 rounded border border-accent/30">{key}</kbd>
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <p className="text-xs font-semibold text-ink uppercase tracking-wider mb-2">Selection & Editing</p>
            {[
              { key: "Escape", desc: "Cancel current drawing / Deselect" },
              { key: "Delete / Backspace", desc: "Delete selected shape" },
              { key: "Enter", desc: "Close polygon (finalize polygon drawing)" },
            ].map(({ key, desc }) => (
              <div key={key} className="bg-panel rounded-xl border border-border px-3 py-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-ink">{desc}</span>
                <kbd className="text-xs text-accent font-mono bg-surface px-2 py-0.5 rounded border border-accent/30">{key}</kbd>
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <p className="text-xs font-semibold text-ink uppercase tracking-wider mb-2">View & Navigation</p>
            {[
              { key: "Scroll Wheel", desc: "Zoom in / out on canvas" },
              { key: "Space + Drag", desc: "Pan the canvas freely" },
              { key: "Fit button", desc: "Fit the entire region in view" },
              { key: "Reset button", desc: "Reset zoom to 100%" },
            ].map(({ key, desc }) => (
              <div key={key} className="bg-panel rounded-xl border border-border px-3 py-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-ink">{desc}</span>
                <kbd className="text-xs text-muted font-mono bg-surface px-2 py-0.5 rounded border border-border">{key}</kbd>
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      id: "workspace",
      title: "Workspace",
      icon: <Settings size={16} />,
      content: (
        <div className="space-y-4 animate-fade-in">
          <h4 className="text-lg font-bold text-ink">Customization Workspace</h4>
          <p className="text-sm text-muted leading-relaxed">
            Rescale, move, or rotate scanned bags within the active bag. Compounding pixel transparency values are calculated live on overlay.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface border border-border rounded-xl p-3 hover:border-accent/30 transition-colors">
              <p className="text-xs font-semibold text-ink mb-1">Canvas Zoom</p>
              <p className="text-xs text-muted leading-relaxed">Use the controls in the bottom-right corner to zoom in/out or maximize the canvas bounds.</p>
            </div>
            <div className="bg-surface border border-border rounded-xl p-3 hover:border-accent/30 transition-colors">
              <p className="text-xs font-semibold text-ink mb-1">Layer Ordering</p>
              <p className="text-xs text-muted leading-relaxed">Adjust z-order of scanned bags from the toolbar to change overlap calculations (Compounding absorption).</p>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "shortcuts",
      title: "Shortcuts",
      icon: <FileText size={16} />,
      content: (
        <div className="space-y-4 animate-fade-in">
          <h4 className="text-lg font-bold text-ink">Canvas Shortcuts & Tips</h4>
          <div className="space-y-2">
            <div className="bg-panel rounded-xl border border-border px-3 py-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-ink">Drag object</span>
              <span className="text-xs text-muted font-mono bg-surface px-1.5 py-0.5 rounded border border-border">Click + MouseMove</span>
            </div>
            <div className="bg-panel rounded-xl border border-border px-3 py-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-ink">Rotate object</span>
              <span className="text-xs text-muted font-mono bg-surface px-1.5 py-0.5 rounded border border-border">Drag blue dot handle</span>
            </div>
            <div className="bg-panel rounded-xl border border-border px-3 py-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-ink">Save Workspace</span>
              <span className="text-xs text-muted font-mono bg-surface px-1.5 py-0.5 rounded border border-border">Ctrl + S (Save button)</span>
            </div>
          </div>
        </div>
      ),
    },
  ];

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="p-2 rounded-lg text-muted hover:text-accent hover:bg-accent/8 transition-all cursor-pointer"
        title="Help"
      >
        <HelpCircle size={20} />
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-[100] flex items-start justify-center p-4 pt-16 animate-fade-in">
          <div className="bg-panel rounded-2xl shadow-panel border border-border w-[950px] max-w-[95vw] max-h-[85vh] flex flex-col overflow-hidden animate-slide-up">
            {/* Header */}
            <div className="px-6 py-4 border-b border-border bg-nav flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-accent/10 text-accent flex items-center justify-center">
                  <HelpCircle size={18} />
                </div>
                <h2 className="font-bold text-ink text-base">User Guide</h2>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-surface transition-all cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="flex flex-1 overflow-hidden">
              {/* Left Nav Sidebar */}
              <div className="w-56 bg-surface border-r border-border py-3 px-2 flex flex-col gap-1 overflow-y-auto flex-shrink-0">
                {sections.map((section) => {
                  const isActive = activeSection === section.id;
                  return (
                    <button
                      key={section.id}
                      onClick={() => setActiveSection(section.id)}
                      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-all cursor-pointer ${
                        isActive 
                          ? "bg-panel text-accent font-semibold border-l-2 border-accent rounded-l-none pl-[10px] shadow-card" 
                          : "text-muted hover:text-ink hover:bg-panel"
                      }`}
                    >
                      <span className="flex-shrink-0">{section.icon}</span>
                      <span className="truncate">{section.title}</span>
                      {isActive && <ChevronRight size={14} className="ml-auto flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>

              {/* Content Area */}
              <div className="flex-1 overflow-y-auto p-6 bg-panel">
                {activeSection ? (
                  sections.find((s) => s.id === activeSection)?.content
                ) : (
                  <div className="py-24 text-center text-muted flex flex-col items-center justify-center">
                    <HelpCircle size={48} className="text-accent/30 mb-3 animate-pulse" />
                    <p className="text-sm font-semibold">No topic selected</p>
                    <p className="text-xs text-muted/70 mt-1">Select a topic from the left sidebar to read specifications.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
