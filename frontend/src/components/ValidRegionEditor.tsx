import React, { useRef, useState, useEffect, useCallback } from 'react';
import { 
  Edit3, 
  Move, 
  Trash2, 
  X,
  Info,
  CheckCircle2,
  Check,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Grid,
  AlertTriangle
} from 'lucide-react';

interface Point {
  x: number;
  y: number;
}

interface Polygon {
  id: string;
  points: Point[];
}

interface ValidRegionEditorProps {
  imageSrc: string;
  initialPoints: any;
  itemId: string;
  onSave: (points: Point[]) => void;
  onCancel: () => void;
  onDelete: () => void;
}

const ValidRegionEditor: React.FC<ValidRegionEditorProps> = ({
  imageSrc,
  initialPoints,
  itemId,
  onSave,
  onCancel,
  onDelete
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [polygons, setPolygons] = useState<Polygon[]>([]);
  const [selectedPolygonId, setSelectedPolygonId] = useState<string | null>(null);
  const [currentTool, setCurrentTool] = useState<'select' | 'polygon'>('select');
  const [isDrawing, setIsDrawing] = useState(false);
  const [tempPolygon, setTempPolygon] = useState<Point[]>([]);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragPolygonStart, setDragPolygonStart] = useState<Polygon | null>(null);
  const [activeVertexIndex, setActiveVertexIndex] = useState<number | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [history, setHistory] = useState<Polygon[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [liveMousePos, setLiveMousePos] = useState<Point | null>(null);
  const [gridSnap, setGridSnap] = useState(false);
  const [gridSize, setGridSize] = useState<10 | 20 | 50>(20);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [toasts, setToasts] = useState<{ id: string; type: 'success'|'warning'|'info'; message: string }[]>([]);

  const createId = () => Math.random().toString(36).substr(2, 9);
  
  const showToast = (type: 'success'|'warning'|'info', message: string) => {
    const id = createId();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 2500);
  };

  const snap = (v: number) => gridSnap ? Math.round(v / gridSize) * gridSize : v;

  const distToSegment = (p: Point, v: Point, w: Point) => {
    const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
    if (l2 === 0) return Math.sqrt((p.x - v.x) ** 2 + (p.y - v.y) ** 2);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.sqrt((p.x - (v.x + t * (w.x - v.x))) ** 2 + (p.y - (v.y + t * (w.y - v.y))) ** 2);
  };

  const updatePolygonsAndHistory = (newPolygons: Polygon[]) => {
    const nextHistory = history.slice(0, historyIndex + 1);
    nextHistory.push([...newPolygons]);
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
    setPolygons(newPolygons);
  };

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      setHistoryIndex(prevIndex);
      setPolygons(history[prevIndex]);
      setSelectedPolygonId(null);
    } else {
      showToast('warning', 'Nothing to undo');
    }
  }, [history, historyIndex]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      setPolygons(history[nextIndex]);
      setSelectedPolygonId(null);
    } else {
      showToast('warning', 'Nothing to redo');
    }
  }, [history, historyIndex]);

  const handleWheel = useCallback((e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - rect.width / 2;
    const mouseY = e.clientY - rect.top - rect.height / 2;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom(prev => {
      const newZoom = Math.max(0.2, Math.min(10, prev * factor));
      const ratio = newZoom / prev;
      setPanOffset(p => ({
        x: mouseX + (p.x - mouseX) * ratio,
        y: mouseY + (p.y - mouseY) * ratio
      }));
      return newZoom;
    });
  }, []);

  const getMousePos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    return {
      x: snap((e.clientX - rect.left) * scaleX),
      y: snap((e.clientY - rect.top) * scaleY)
    };
  };

  const finishPolygon = () => {
    console.log('finishPolygon called with tempPolygon:', tempPolygon);
    if (tempPolygon.length >= 3) {
      const newPolygon: Polygon = {
        id: createId(),
        points: [...tempPolygon]
      };
      console.log('finishPolygon adding newPolygon:', newPolygon);
      updatePolygonsAndHistory([...polygons, newPolygon]);
      setTempPolygon([]);
      setIsDrawing(false);
      showToast('success', 'Polygon added');
    } else {
      showToast('warning', 'Polygon needs at least 3 points');
    }
  };

  const deleteSelectedPolygon = () => {
    if (selectedPolygonId) {
      const newPolygons = polygons.filter(p => p.id !== selectedPolygonId);
      updatePolygonsAndHistory(newPolygons);
      setSelectedPolygonId(null);
    }
  };

  const clearAll = () => {
    updatePolygonsAndHistory([]);
    setSelectedPolygonId(null);
  };

  const handleSave = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    console.log('handleSave: polygons:', polygons, 'tempPolygon:', tempPolygon, 'isDrawing:', isDrawing);
    
    // If there are polygons, combine them (or just take the first one for now)
    let pointsToSave: Point[] = [];
    if (polygons.length > 0) {
      pointsToSave = polygons[0].points;
    } else if (tempPolygon.length >= 3) {
      // If user was still drawing, save the temp polygon
      pointsToSave = tempPolygon;
    }
    
    console.log('handleSave: pointsToSave before normalize:', pointsToSave);
    
    // Normalize points
    const normalizedPoints = pointsToSave.map(p => ({
      x: p.x / canvas.width,
      y: p.y / canvas.height
    }));
    
    console.log('handleSave: normalizedPoints:', normalizedPoints);
    
    onSave(normalizedPoints);
    showToast('success', 'Valid region saved');
  };

  const isPointInPolygon = (point: Point, polygonPoints: Point[]) => {
    let inside = false;
    for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i++) {
      const xi = polygonPoints[i].x, yi = polygonPoints[i].y;
      const xj = polygonPoints[j].x, yj = polygonPoints[j].y;
      const intersect = ((yi > point.y) !== (yj > point.y))
        && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getMousePos(e);
    
    if (e.button === 1 || isSpacePressed) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
      e.preventDefault();
      return;
    }

    if (currentTool === 'polygon') {
      setTempPolygon(prev => [...prev, pos]);
      setIsDrawing(true);
      return;
    }

    if (currentTool === 'select') {
      // Check if clicking on a vertex
      if (selectedPolygonId) {
        const selectedPolygon = polygons.find(p => p.id === selectedPolygonId);
        if (selectedPolygon) {
          for (let i = 0; i < selectedPolygon.points.length; i++) {
            const vertex = selectedPolygon.points[i];
            const dx = pos.x - vertex.x;
            const dy = pos.y - vertex.y;
            if (Math.sqrt(dx*dx + dy*dy) <= 10) {
              setActiveVertexIndex(i);
              setIsDragging(true);
              setDragStart(pos);
              setDragPolygonStart({ ...selectedPolygon, points: selectedPolygon.points.map(p => ({ ...p })) });
              return;
            }
          }
          
          // Check if clicking on an edge to add a vertex
          for (let i = 0; i < selectedPolygon.points.length; i++) {
            const j = (i + 1) % selectedPolygon.points.length;
            if (distToSegment(pos, selectedPolygon.points[i], selectedPolygon.points[j]) < 8) {
              const newPoints = [...selectedPolygon.points];
              newPoints.splice(i + 1, 0, pos);
              const updatedPolygons = polygons.map(p => p.id === selectedPolygonId ? { ...p, points: newPoints } : p);
              updatePolygonsAndHistory(updatedPolygons);
              setActiveVertexIndex(i + 1);
              setIsDragging(true);
              setDragStart(pos);
              setDragPolygonStart({ ...selectedPolygon, points: newPoints.map(p => ({ ...p })) });
              return;
            }
          }
        }
      }
      
      // Check if clicking on a polygon
      const clickedPolygon = [...polygons].reverse().find(polygon => {
        return isPointInPolygon(pos, polygon.points);
      });
      
      if (clickedPolygon) {
        setSelectedPolygonId(clickedPolygon.id);
        setActiveVertexIndex(null);
        setIsDragging(true);
        setDragStart(pos);
        setDragPolygonStart({ ...clickedPolygon, points: clickedPolygon.points.map(p => ({ ...p })) });
      } else {
        setSelectedPolygonId(null);
        setActiveVertexIndex(null);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      setPanOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
      return;
    }

    const pos = getMousePos(e);
    setCursorPos(pos);
    setLiveMousePos(pos);

    if (isDragging && dragPolygonStart && dragStart) {
      const dx = pos.x - dragStart.x;
      const dy = pos.y - dragStart.y;
      
      if (activeVertexIndex !== null) {
        // Dragging a vertex
        setPolygons(prev => prev.map(p => {
          if (p.id === selectedPolygonId) {
            const newPoints = [...dragPolygonStart.points];
            newPoints[activeVertexIndex] = {
              x: dragPolygonStart.points[activeVertexIndex].x + dx,
              y: dragPolygonStart.points[activeVertexIndex].y + dy
            };
            return { ...p, points: newPoints };
          }
          return p;
        }));
      } else {
        // Dragging the whole polygon
        setPolygons(prev => prev.map(p => {
          if (p.id === selectedPolygonId) {
            return {
              ...p,
              points: dragPolygonStart.points.map(pt => ({
                x: pt.x + dx,
                y: pt.y + dy
              }))
            };
          }
          return p;
        }));
      }
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }

    if (isDragging) {
      setIsDragging(false);
      setDragStart(null);
      setDragPolygonStart(null);
      setActiveVertexIndex(null);
      updatePolygonsAndHistory(polygons);
    }
  };

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') {
      return;
    }
    
    if (e.code === 'Space') {
      setIsSpacePressed(true);
      e.preventDefault();
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedPolygonId) {
        deleteSelectedPolygon();
      }
    }

    if (e.key === 'Escape') {
      if (isDrawing && tempPolygon.length > 0) {
        setTempPolygon([]);
        setIsDrawing(false);
      } else {
        setSelectedPolygonId(null);
      }
    }

    // If in polygon mode and press Enter, finish the polygon
    if (e.key === 'Enter' && currentTool === 'polygon' && tempPolygon.length >= 3) {
      finishPolygon();
    }

    switch(e.key.toLowerCase()) {
      case 'v': return setCurrentTool('select');
      case 'p': return setCurrentTool('polygon');
      case 'g': return setGridSnap(!gridSnap);
    }
    
    if ((e.ctrlKey || e.metaKey)) {
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
      }
    }
  }, [selectedPolygonId, polygons, handleUndo, handleRedo, gridSnap, currentTool, tempPolygon, isDrawing]);

  const handleKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      setIsSpacePressed(false);
    }
  };

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.addEventListener('wheel', handleWheel, { passive: false });
    }
    return () => {
      if (canvas) {
        canvas.removeEventListener('wheel', handleWheel);
      }
    };
  }, [handleWheel]);

  useEffect(() => {
    if (!imageDimensions.width || !imageDimensions.height) return;
    
    let polygonsToLoad: Polygon[] = [];
    
    if (Array.isArray(initialPoints) && initialPoints.length > 0) {
      const isNormalized = initialPoints.every(p => 
        typeof p === 'object' && p !== null && 
        'x' in p && 'y' in p && 
        typeof p.x === 'number' && typeof p.y === 'number' && 
        p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
      );
      
      const denormalizedPoints = initialPoints.map(p => ({
        x: (isNormalized ? p.x : p.x) * (isNormalized ? imageDimensions.width : 1),
        y: (isNormalized ? p.y : p.y) * (isNormalized ? imageDimensions.height : 1)
      }));
      
      polygonsToLoad = [{
        id: 'initial',
        points: denormalizedPoints
      }];
    }
    
    setPolygons(polygonsToLoad);
    setHistory([polygonsToLoad.map(p => ({ ...p, points: p.points.map(pt => ({ ...pt })) }))]);
    setHistoryIndex(0);
  }, [initialPoints, imageDimensions]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!imgRef.current) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imgRef.current, 0, 0);
    
    // Draw grid if snap enabled
    if (gridSnap) {
      ctx.save();
      // Minor grid lines
      ctx.strokeStyle = 'rgba(37, 99, 235, 0.15)';
      ctx.lineWidth = 0.5;
      for (let x = 0; x <= canvas.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y <= canvas.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }
      
      // Major grid lines (every 5th line)
      ctx.strokeStyle = 'rgba(37, 99, 235, 0.5)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= canvas.width; x += gridSize * 5) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y <= canvas.height; y += gridSize * 5) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }
      ctx.restore();
    }
    
    // Draw all polygons
    polygons.forEach(polygon => {
      if (polygon.points.length > 0) {
        ctx.save();
        ctx.fillStyle = 'rgba(22, 163, 74, 0.35)';
        ctx.strokeStyle = 'rgba(22, 163, 74, 0.8)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(polygon.points[0].x, polygon.points[0].y);
        polygon.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        if (polygon.id === selectedPolygonId) {
          // Draw selected polygon border
          ctx.globalAlpha = 1;
          ctx.strokeStyle = '#2563EB';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.moveTo(polygon.points[0].x, polygon.points[0].y);
          polygon.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
          ctx.closePath();
          ctx.stroke();
          
          // Draw vertices
          ctx.setLineDash([]);
          const vertexSize = 12;
          polygon.points.forEach((point, index) => {
        ctx.fillStyle = 'white';
        ctx.strokeStyle = '#16A34A';
        ctx.lineWidth = 1.5;
        ctx.fillRect(point.x - vertexSize/2, point.y - vertexSize/2, vertexSize, vertexSize);
        ctx.strokeRect(point.x - vertexSize/2, point.y - vertexSize/2, vertexSize, vertexSize);
          });
        }
        
        ctx.restore();
      }
    });
    
    // Draw temp polygon
    if (currentTool === 'polygon' && tempPolygon.length > 0 && liveMousePos) {
      ctx.save();
      ctx.globalAlpha = 1;
      
      // Draw lines
      ctx.strokeStyle = '#16A34A';
      ctx.lineWidth = 4;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(tempPolygon[0].x, tempPolygon[0].y);
      tempPolygon.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      ctx.lineTo(liveMousePos.x, liveMousePos.y);
      if (tempPolygon.length >= 2) {
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = 'rgba(22, 163, 74, 0.35)';
        ctx.lineTo(tempPolygon[0].x, tempPolygon[0].y);
      }
      ctx.stroke();
      
      // Draw temp vertices
      ctx.setLineDash([]);
      tempPolygon.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, 2 * Math.PI);
        ctx.fillStyle = '#16A34A';
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
      
      // Draw animated close indicator at first point if we have enough points
      if (tempPolygon.length >= 3) {
        const firstPt = tempPolygon[0];
        ctx.beginPath();
        ctx.arc(firstPt.x, firstPt.y, 10, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(22, 163, 74, 0.3)';
        ctx.lineWidth = 3;
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(firstPt.x, firstPt.y, 8, 0, 2 * Math.PI);
        ctx.strokeStyle = '#16A34A';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      
      ctx.restore();
    }
  }, [polygons, selectedPolygonId, gridSnap, gridSize, liveMousePos, tempPolygon, currentTool]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  return (
    <div className="fixed inset-0 flex items-start justify-center z-[100] p-4 pt-20 text-sm select-none" style={{ fontFamily: 'Inter, system-ui, sans-serif', backgroundColor: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(12px)' }}>
      <style>{`
        @keyframes slide-down {
          from { opacity:0; transform: translateY(-8px); }
          to { opacity:1; transform: translateY(0); }
        }
        .animate-slide-down { animation: slide-down 0.2s ease-out; }
      `}</style>
      
      {/* Toast Notifications */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[200] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div 
            key={t.id} 
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border shadow-md text-xs font-medium animate-slide-down"
            style={{
              backgroundColor: t.type === 'success' ? '#ECFDF5' : t.type === 'warning' ? '#FFFBEB' : '#EFF4FF',
              borderColor: t.type === 'success' ? '#6EE7B7' : t.type === 'warning' ? '#FCD34D' : '#BFDBFE',
              color: t.type === 'success' ? '#065F46' : t.type === 'warning' ? '#92400E' : '#1E40AF'
            }}
          >
            {t.type === 'success' ? <CheckCircle2 size={14}/> : t.type === 'warning' ? <AlertTriangle size={14}/> : <Info size={14}/>}
            {t.message}
          </div>
        ))}
      </div>
      
      {/* Modal Container */}
      <div 
        className="bg-white rounded-2xl shadow-xl border border-[#DDE4F5] flex flex-col overflow-hidden w-full max-w-[1100px] h-[85vh]"
        style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-[#DDE4F5] bg-white flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="font-bold text-base text-[#0F172A]">Edit Valid Placement Region</h2>
              <p className="text-xs text-[#64748B] mt-0.5">
                Draw a polygon to define the valid region
              </p>
            </div>
            <button 
              onClick={() => setShowHelp(!showHelp)} 
              className="p-1.5 rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-[#F5F8FF] transition-all cursor-pointer border border-transparent hover:border-[#DDE4F5]"
              title="Show help & shortcuts"
            >
              <Info size={20} />
            </button>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-[#F5F8FF] transition-all cursor-pointer border border-transparent hover:border-[#DDE4F5]">
            <X size={20} />
          </button>
        </div>

        {/* Help Panel */}
        {showHelp && (
          <div className="px-6 py-4 border-b border-[#DDE4F5] bg-[#EFF4FF] flex-shrink-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h3 className="font-semibold text-sm text-[#0F172A] mb-2 flex items-center gap-1.5">
                  <Info size={16} />
                  How to Use & Hotkeys
                </h3>
                <ul className="text-xs text-[#64748B] space-y-1">
                  <li>• <strong>Select (V)</strong>: Move polygons or drag vertices</li>
                  <li>• <strong>Polygon (P)</strong>: Click points, press Enter to finish</li>
                  <li>• <strong>Pan Workspace</strong>: Middle click and drag OR hold Spacebar + drag</li>
                  <li>• <strong>Zoom to Cursor</strong>: Ctrl + scroll wheel</li>
                  <li>• <strong>Undo / Redo</strong>: Ctrl+Z / Ctrl+Y</li>
                  <li>• <strong>Delete selected</strong>: Del or Backspace</li>
                  <li>• <strong>Cancel drawing/deselect</strong>: Esc</li>
                  <li>• <strong>Save</strong>: Ctrl+S</li>
                  <li>• <strong>Grid snap</strong>: G to toggle</li>
                </ul>
              </div>
            </div>
          </div>
        )}
        
        {/* Toolbar */}
        <div className="px-5 py-3 border-b border-[#DDE4F5] bg-white flex flex-wrap gap-3 items-center flex-shrink-0">
          {/* Tools Grid */}
          <div className="flex items-center gap-1 bg-[#F5F8FF] border border-[#DDE4F5] rounded-xl p-1">
            <button
              onClick={() => setCurrentTool('select')}
              className={`p-2 rounded-lg transition-all border-none cursor-pointer ${currentTool === 'select' ? 'bg-[#EFF4FF] text-[#2563EB] font-semibold border border-[#B8C8F0]' : 'text-[#64748B] hover:text-[#0F172A] hover:bg-white'}`}
              title="Select (V)"
            >
              <Move size={18} />
            </button>
            <button
              onClick={() => setCurrentTool('polygon')}
              className={`p-2 rounded-lg transition-all border-none cursor-pointer ${currentTool === 'polygon' ? 'bg-[#EFF4FF] text-[#2563EB] font-semibold border border-[#B8C8F0]' : 'text-[#64748B] hover:text-[#0F172A] hover:bg-white'}`}
              title="Polygon (P)"
            >
              <Edit3 size={18} />
            </button>
          </div>
          
          {/* Finish Polygon Button */}
          {currentTool === 'polygon' && tempPolygon.length >= 3 && (
            <button
              onClick={finishPolygon}
              className="px-3 py-1.5 bg-[#EFF4FF] text-[#2563EB] rounded-xl text-xs font-semibold border border-[#B8C8F0] hover:bg-[#EFF4FF] transition-all cursor-pointer"
            >
              Finish Polygon
            </button>
          )}
          
          {/* Grid Snap */}
          <div className="flex items-center gap-1 bg-[#F5F8FF] border border-[#DDE4F5] rounded-xl p-1">
            <button
              onClick={() => setGridSnap(!gridSnap)}
              className={`p-1.5 rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-white transition-all bg-transparent border-none cursor-pointer ${gridSnap ? 'bg-[#EFF4FF] text-[#2563EB] font-semibold border border-[#B8C8F0]' : ''}`}
              title="Grid Snap (G)"
            >
              <Grid size={16} />
            </button>
            {gridSnap && (
              <select
                value={gridSize}
                onChange={(e) => setGridSize(parseInt(e.target.value) as 10 | 20 | 50)}
                className="text-xs bg-transparent border-none text-[#64748B] cursor-pointer focus:outline-none"
              >
                <option value={10}>10px</option>
                <option value={20}>20px</option>
                <option value={50}>50px</option>
              </select>
            )}
          </div>
          
          {/* Internal Undo/Redo */}
          <div className="flex items-center gap-1 bg-[#F5F8FF] border border-[#DDE4F5] rounded-xl p-1">
            <button
              onClick={handleUndo}
              disabled={historyIndex <= 0}
              className="p-1.5 rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-white disabled:opacity-35 disabled:cursor-not-allowed transition-all bg-transparent border-none cursor-pointer"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 size={16} />
            </button>
            <button
              onClick={handleRedo}
              disabled={historyIndex >= history.length - 1}
              className="p-1.5 rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-white disabled:opacity-35 disabled:cursor-not-allowed transition-all bg-transparent border-none cursor-pointer"
              title="Redo (Ctrl+Y)"
            >
              <Redo2 size={16} />
            </button>
          </div>
          
          {/* Actions */}
          <div className="flex items-center gap-2 ml-auto">
            {selectedPolygonId && (
              <button
                onClick={deleteSelectedPolygon}
                className="px-3 py-1.5 bg-[#FEF2F2] text-[#DC2626] rounded-xl text-xs font-semibold border border-[#FCA5A5] hover:bg-[#FEE2E2] transition-all cursor-pointer"
              >
                <Trash2 size={14} className="inline mr-1" />
                Delete Selected
              </button>
            )}
            <button
              onClick={clearAll}
              className="px-3 py-1.5 bg-white text-[#64748B] rounded-xl text-xs font-semibold border border-[#DDE4F5] hover:bg-[#F5F8FF] transition-all cursor-pointer"
            >
              Clear All
            </button>
          </div>
        </div>
        
        {/* Main Work Pane */}
        <div className="flex flex-1 overflow-hidden">
          {/* Canvas area */}
          <div className="flex-1 overflow-hidden bg-white relative flex items-center justify-center">
            <div className="absolute inset-0 flex items-center justify-center p-6 overflow-auto">
              <div 
                className="relative shadow-2xl bg-white border border-[#DDE4F5]"
                style={{
                  width: imageDimensions.width > 0 ? imageDimensions.width : 800,
                  height: imageDimensions.height > 0 ? imageDimensions.height : 600,
                  transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
                  transformOrigin: 'center center',
                  transition: isPanning ? 'none' : 'transform 0.1s ease-out'
                }}
              >
                <canvas
                  ref={canvasRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  className={currentTool === 'select' ? 'cursor-default' : 'crosshair'}
                  style={{ display: 'block' }}
                />
                <img
                  ref={imgRef}
                  src={imageSrc}
                  alt=""
                  crossOrigin="anonymous"
                  onLoad={(e) => {
                    const img = e.target as HTMLImageElement;
                    console.log("Image loaded successfully!", { width: img.width, height: img.height });
                    setImageDimensions({ width: img.width, height: img.height });
                    const canvas = canvasRef.current;
                    if (canvas) {
                      canvas.width = img.width;
                      canvas.height = img.height;
                      
                      // Use actual container dimensions for proper fit
                      const container = containerRef.current;
                      if (container) {
                        const rect = container.getBoundingClientRect();
                        const availableWidth = rect.width - 48; // account for p-6 padding
                        const availableHeight = rect.height - 48;
                        const scaleX = availableWidth / img.width;
                        const scaleY = availableHeight / img.height;
                        const initialZoom = Math.min(Math.min(scaleX, scaleY), 1.5);
                        setZoom(initialZoom);
                      } else {
                        // Fallback to conservative estimate
                        const availableWidth = Math.min(1000, window.innerWidth - 100);
                        const availableHeight = Math.min(600, window.innerHeight - 300);
                        const scaleX = availableWidth / img.width;
                        const scaleY = availableHeight / img.height;
                        const initialZoom = Math.min(Math.min(scaleX, scaleY), 1.5);
                        setZoom(initialZoom);
                      }
                      setPanOffset({ x: 0, y: 0 });
                      
                      drawCanvas();
                    }
                  }}
                  onError={(e) => {
                    console.error("Error loading image", e);
                    console.log("Attempted to load:", imageSrc);
                  }}
                  style={{ display: 'none' }}
                />
              </div>
            </div>
            
            {/* Coordinates HUD */}
            <div className="absolute bottom-4 left-4 z-10 bg-white border border-[#DDE4F5] rounded-xl px-3 py-2 shadow-sm">
              <p className="font-mono text-[11px] text-[#0F172A]">
                X: <span className="text-[#2563EB]">{Math.round(cursorPos.x)}</span>
                &nbsp;&nbsp;Y: <span className="text-[#2563EB]">{Math.round(cursorPos.y)}</span>
              </p>
              <p className="font-mono text-[10px] text-[#64748B] mt-0.5">
                ({imageDimensions.width > 0 ? (cursorPos.x / imageDimensions.width).toFixed(2) : '0.00'},&nbsp;
                 {imageDimensions.height > 0 ? (cursorPos.y / imageDimensions.height).toFixed(2) : '0.00'})
              </p>
            </div>
            
            {/* Floating Zoom Controls */}
            <div className="absolute bottom-4 right-4 flex gap-1 z-10 shadow-sm bg-white p-1 rounded-xl border border-[#DDE4F5]">
              <button
                onClick={() => setZoom(prev => Math.min(10, prev + 0.15))}
                className="w-7 h-7 bg-transparent border-none rounded-lg flex items-center justify-center text-[#64748B] hover:text-[#0F172A] cursor-pointer hover:bg-[#F5F8FF] transition-colors"
                title="Zoom In"
              >
                <ZoomIn size={15} />
              </button>
              <button
                onClick={() => setZoom(prev => Math.max(0.2, prev - 0.15))}
                className="w-7 h-7 bg-transparent border-none rounded-lg flex items-center justify-center text-[#64748B] hover:text-[#0F172A] cursor-pointer hover:bg-[#F5F8FF] transition-colors"
                title="Zoom Out"
              >
                <ZoomOut size={15} />
              </button>
              <button
                onClick={() => {
                  if (imgRef.current) {
                    const availableWidth = window.innerWidth * 0.7;
                    const availableHeight = window.innerHeight * 0.7;
                    const scaleX = availableWidth / imgRef.current.width;
                    const scaleY = availableHeight / imgRef.current.height;
                    const initialZoom = Math.min(Math.min(scaleX, scaleY), 2.0);
                    setZoom(initialZoom);
                  }
                  setPanOffset({ x: 0, y: 0 });
                }}
                className="w-7 h-7 bg-transparent border-none rounded-lg flex items-center justify-center text-[#64748B] hover:text-[#0F172A] cursor-pointer hover:bg-[#F5F8FF] transition-colors"
                title="Reset View"
              >
                <Maximize2 size={15} />
              </button>
            </div>
          </div>
        </div>
        
        {/* Status Bar */}
        <div className="px-5 py-2 border-t border-[#DDE4F5] bg-[#F5F8FF] flex items-center justify-between flex-shrink-0">
          <span className="text-xs text-[#64748B] flex items-center gap-1.5">
            {polygons.length} Polygon{polygons.length !== 1 ? 's' : ''}
            {zoom !== 1 && ` · Zoom: ${Math.round(zoom * 100)}%`}
            {(panOffset.x !== 0 || panOffset.y !== 0) && " · Panned"}
          </span>
          {selectedPolygonId && (
            <span className="text-xs text-[#2563EB] font-medium flex items-center gap-1">
              <CheckCircle2 size={14} />
              Selected for edit
            </span>
          )}
        </div>
        
        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#DDE4F5] bg-white flex justify-between items-center flex-shrink-0">
          <button 
            onClick={() => {
              if (confirm("Are you sure you want to remove the entire valid region?")) {
                onDelete();
              }
            }} 
            className="px-4 py-2 border border-[#FCA5A5] text-[#DC2626] hover:bg-[#FEF2F2] rounded-lg text-sm font-semibold transition-all cursor-pointer bg-white"
          >
            Delete Region
          </button>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={onCancel} 
              className="px-4 py-2 border border-[#DDE4F5] text-[#64748B] hover:bg-[#F5F8FF] rounded-lg text-sm font-semibold transition-all cursor-pointer bg-white"
            >
              Cancel
            </button>
            <button 
              onClick={handleSave} 
              className="px-5 py-2.5 rounded-lg font-semibold text-white bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] shadow-sm hover:shadow-md hover:opacity-95 transition-all flex items-center gap-1.5 text-sm cursor-pointer"
            >
              <Check size={15} />
              Save Region
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ValidRegionEditor;
