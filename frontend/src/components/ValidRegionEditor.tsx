import React, { useRef, useState, useEffect, useCallback } from 'react';
import { 
  Square, 
  Circle, 
  Edit3, 
  Move, 
  Trash2, 
  Plus, 
  Minus, 
  RotateCcw,
  Layers,
  X,
  Info,
  CheckCircle2,
  Check,
  Undo2,
  Redo2,
  Eye,
  EyeOff,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Grid,
  Lock,
  Unlock,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Clipboard,
  MousePointer,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  Download
} from 'lucide-react';

interface Point {
  x: number;
  y: number;
}

type ShapeType = 'rectangle' | 'circle' | 'polygon';

interface Shape {
  id: string;
  type: ShapeType;
  isPositive: boolean;
  points: Point[];
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  visible: boolean;
  locked: boolean;
  label: string;
  opacity: number;
}

interface ValidRegionEditorProps {
  imageSrc: string;
  initialPoints: any;
  itemId: string;
  onSave: (points: Point[], shapes?: any[]) => void;
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
  // -------------------------------
  // State Declarations
  // -------------------------------
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [currentTool, setCurrentTool] = useState<ShapeType | 'select' | 'move'>('select');
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingStart, setDrawingStart] = useState<Point | null>(null);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragShapeStart, setDragShapeStart] = useState<Shape | null>(null);
  const [activeMode, setActiveMode] = useState<'add' | 'remove'>('add');
  const [activeHandle, setActiveHandle] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [history, setHistory] = useState<Shape[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [liveMousePos, setLiveMousePos] = useState<Point | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [gridSnap, setGridSnap] = useState(false);
  const [gridSize, setGridSize] = useState<10 | 20 | 50>(20);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [clipboardShape, setClipboardShape] = useState<Shape | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; target: 'shape' | 'canvas'; shapeId?: string } | null>(null);
  const [toasts, setToasts] = useState<{ id: string; type: 'success'|'warning'|'info'; message: string }[]>([]);
  const [rectCount, setRectCount] = useState(0);
  const [circleCount, setCircleCount] = useState(0);
  const [polygonCount, setPolygonCount] = useState(0);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editingLabelText, setEditingLabelText] = useState("");
  const [expandedLayerId, setExpandedLayerId] = useState<string | null>(null);

  // -------------------------------
  // Helpers
  // -------------------------------
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

  const updateShapesAndHistory = (newShapes: Shape[]) => {
    const cleanShapes = newShapes.filter(s => !s.id.startsWith('temp-'));
    const nextHistory = history.slice(0, historyIndex + 1);
    nextHistory.push(cleanShapes);
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
    setShapes(newShapes);
  };

  const getHandlePosition = (shape: Shape, handleIndex: number): Point | null => {
    if (shape.type === 'rectangle') {
      const handles = [
        { x: shape.x, y: shape.y },
        { x: shape.x + shape.width, y: shape.y },
        { x: shape.x + shape.width, y: shape.y + shape.height },
        { x: shape.x, y: shape.y + shape.height },
        { x: shape.x + shape.width/2, y: shape.y },
        { x: shape.x + shape.width, y: shape.y + shape.height/2 },
        { x: shape.x + shape.width/2, y: shape.y + shape.height },
        { x: shape.x, y: shape.y + shape.height/2 }
      ];
      return handles[handleIndex] || null;
    } else if (shape.type === 'circle') {
      const handles = [
        { x: shape.x, y: shape.y - shape.radius },
        { x: shape.x + shape.radius, y: shape.y },
        { x: shape.x, y: shape.y + shape.radius },
        { x: shape.x - shape.radius, y: shape.y }
      ];
      return handles[handleIndex] || null;
    } else if (shape.type === 'polygon') {
      return shape.points[handleIndex] || null;
    }
    return null;
  };

  const drawShapeOnCtx = (ctx: CanvasRenderingContext2D, shape: Shape) => {
    ctx.beginPath();
    if (shape.type === 'rectangle') {
      ctx.rect(shape.x, shape.y, shape.width, shape.height);
    } else if (shape.type === 'circle') {
      ctx.arc(shape.x, shape.y, shape.radius, 0, 2 * Math.PI);
    } else if (shape.type === 'polygon' && shape.points.length > 0) {
      ctx.moveTo(shape.points[0].x, shape.points[0].y);
      shape.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
  };

  // -------------------------------
  // Feature Implementations
  // -------------------------------
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      setHistoryIndex(prevIndex);
      setShapes(history[prevIndex]);
      setSelectedShapeId(null);
    } else {
      showToast('warning', 'Nothing to undo');
    }
  }, [history, historyIndex]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      setShapes(history[nextIndex]);
      setSelectedShapeId(null);
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

  const moveLayer = (id: string, dir: 'up' | 'down') => {
    const idx = shapes.findIndex(s => s.id === id);
    if (dir === 'up' && idx < shapes.length - 1) {
      const arr = [...shapes];
      [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
      updateShapesAndHistory(arr);
    } else if (dir === 'down' && idx > 0) {
      const arr = [...shapes];
      [arr[idx], arr[idx - 1]] = [arr[idx - 1], arr[idx]];
      updateShapesAndHistory(arr);
    }
  };

  const updateOpacity = (id: string, newOpacity: number) => {
    updateShapesAndHistory(shapes.map(s => s.id === id ? { ...s, opacity: newOpacity } : s));
  };

  const exportMask = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const offscreen = document.createElement('canvas');
    offscreen.width = canvas.width;
    offscreen.height = canvas.height;
    const ctx = offscreen.getContext('2d')!;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, offscreen.width, offscreen.height);
    
    shapes.filter(s => s.isPositive && s.visible !== false).forEach(shape => {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'white';
      ctx.beginPath();
      if (shape.type === 'rectangle') ctx.rect(shape.x, shape.y, shape.width, shape.height);
      else if (shape.type === 'circle') ctx.arc(shape.x, shape.y, shape.radius, 0, 2 * Math.PI);
      else if (shape.type === 'polygon') {
        if (shape.points.length > 0) {
          ctx.moveTo(shape.points[0].x, shape.points[0].y);
          shape.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
          ctx.closePath();
        }
      }
      ctx.fill();
    });
    
    shapes.filter(s => !s.isPositive && s.visible !== false).forEach(shape => {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'white';
      ctx.beginPath();
      if (shape.type === 'rectangle') ctx.rect(shape.x, shape.y, shape.width, shape.height);
      else if (shape.type === 'circle') ctx.arc(shape.x, shape.y, shape.radius, 0, 2 * Math.PI);
      else if (shape.type === 'polygon') {
        if (shape.points.length > 0) {
          ctx.moveTo(shape.points[0].x, shape.points[0].y);
          shape.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
          ctx.closePath();
        }
      }
      ctx.fill();
    });
    
    const link = document.createElement('a');
    link.download = `${itemId}_mask.png`;
    link.href = offscreen.toDataURL('image/png');
    link.click();
    showToast('success', 'Mask exported as PNG');
  };

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
    const finishedShapes = shapes.map(s => {
      if (s.id.startsWith('temp-') && s.type === 'polygon') {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        s.points.forEach(p => {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        });
        const newPolyCount = polygonCount + 1;
        setPolygonCount(newPolyCount);
        
        return { 
          ...s, 
          id: createId(),
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
          label: `Polygon ${newPolyCount}`
        };
      }
      return s;
    });
    updateShapesAndHistory(finishedShapes);
    setIsDrawing(false);
    setDrawingStart(null);
  };

  const deleteSelectedShape = () => {
    if (selectedShapeId) {
      const newShapes = shapes.filter(s => s.id !== selectedShapeId);
      updateShapesAndHistory(newShapes);
      setSelectedShapeId(null);
    }
  };

  const clearAll = () => {
    updateShapesAndHistory([]);
    setSelectedShapeId(null);
  };

  const handleSave = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const normalizedShapes = shapes.map(shape => {
      const normalized: any = {
        type: shape.type,
        isPositive: shape.isPositive,
        visible: shape.visible,
        locked: shape.locked,
        label: shape.label,
        opacity: shape.opacity
      };
      
      if (shape.type === 'rectangle') {
        normalized.x = shape.x / canvas.width;
        normalized.y = shape.y / canvas.height;
        normalized.width = shape.width / canvas.width;
        normalized.height = shape.height / canvas.height;
      } else if (shape.type === 'circle') {
        normalized.x = shape.x / canvas.width;
        normalized.y = shape.y / canvas.height;
        normalized.radius = shape.radius / Math.max(canvas.width, canvas.height);
      } else if (shape.type === 'polygon') {
        normalized.points = shape.points.map(p => ({
          x: p.x / canvas.width,
          y: p.y / canvas.height
        }));
      }
      
      return normalized;
    });
    
    let simplifiedPoints: Point[] = [];
    const positiveRects = shapes.filter(s => s.type === 'rectangle' && s.isPositive && s.visible !== false);
    if (positiveRects.length > 0) {
      const first = positiveRects[0];
      simplifiedPoints = [
        { x: first.x, y: first.y },
        { x: first.x + first.width, y: first.y },
        { x: first.x + first.width, y: first.y + first.height },
        { x: first.x, y: first.y + first.height }
      ];
    } else {
      const positiveShapes = shapes.filter(s => s.isPositive && s.visible !== false);
      if (positiveShapes.length > 0) {
        const firstPos = positiveShapes[0];
        if (firstPos.type === 'polygon') {
          simplifiedPoints = firstPos.points;
        } else if (firstPos.type === 'circle') {
          simplifiedPoints = [
            { x: firstPos.x - firstPos.radius, y: firstPos.y },
            { x: firstPos.x, y: firstPos.y - firstPos.radius },
            { x: firstPos.x + firstPos.radius, y: firstPos.y },
            { x: firstPos.x, y: firstPos.y + firstPos.radius }
          ];
        }
      }
    }
    
    simplifiedPoints = simplifiedPoints.map(p => ({
      x: p.x / canvas.width,
      y: p.y / canvas.height
    }));
    
    try {
      if (itemId) {
        await fetch(`http://localhost:8080/api/items/${itemId}/valid-region`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            shapes: normalizedShapes, 
            validRegionPoints: simplifiedPoints 
          })
        });
      }
      showToast('success', 'Valid region saved');
    } catch (e) {
      console.error('Error saving:', e);
      showToast('warning', 'Failed to save');
    }
    
    onSave(simplifiedPoints, normalizedShapes);
  };

  // -------------------------------
  // Handlers
  // -------------------------------
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getMousePos(e);
    setContextMenu(null);
    
    if (e.button === 1 || isSpacePressed) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
      e.preventDefault();
      return;
    }

    if (currentTool === 'select' || currentTool === 'move') {
      if (selectedShapeId) {
        const selectedShape = shapes.find(s => s.id === selectedShapeId);
        if (selectedShape && selectedShape.visible !== false && !selectedShape.locked) {
          const handleCount = selectedShape.type === 'rectangle' ? 8 : (selectedShape.type === 'circle' ? 4 : selectedShape.points.length);
          for (let i = 0; i < handleCount; i++) {
            const handlePos = getHandlePosition(selectedShape, i);
            if (handlePos) {
              const dx = pos.x - handlePos.x;
              const dy = pos.y - handlePos.y;
              if (Math.sqrt(dx*dx + dy*dy) <= 10) {
                setActiveHandle(i.toString());
                setIsDragging(true);
                setDragStart(pos);
                setDragShapeStart({
                  ...selectedShape,
                  points: selectedShape.points.map(p => ({ ...p }))
                });
                return;
              }
            }
          }
          
          if (selectedShape.type === 'polygon') {
            const vs = selectedShape.points;
            for (let i = 0; i < vs.length; i++) {
              const j = (i + 1) % vs.length;
              if (distToSegment(pos, vs[i], vs[j]) < 8) {
                const newPoints = [...vs];
                newPoints.splice(i + 1, 0, pos);
                const updatedShapes = shapes.map(s => s.id === selectedShapeId ? { ...s, points: newPoints } : s);
                updateShapesAndHistory(updatedShapes);
                setActiveHandle((i + 1).toString());
                setIsDragging(true);
                setDragStart(pos);
                setDragShapeStart({
                  ...selectedShape,
                  points: newPoints.map(p => ({ ...p }))
                });
                return;
              }
            }
          }
        }
      }
      
      const clickedShape = [...shapes].reverse().find(shape => {
        if (shape.visible === false || shape.locked) return false;
        if (shape.type === 'rectangle') {
          return pos.x >= shape.x && pos.x <= shape.x + shape.width && 
                 pos.y >= shape.y && pos.y <= shape.y + shape.height;
        } else if (shape.type === 'circle') {
          const dx = pos.x - shape.x;
          const dy = pos.y - shape.y;
          return Math.sqrt(dx*dx + dy*dy) <= shape.radius;
        } else if (shape.type === 'polygon' && shape.points.length > 2) {
          let inside = false;
          const vs = shape.points;
          for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
            const xi = vs[i].x, yi = vs[i].y;
            const xj = vs[j].x, yj = vs[j].y;
            const intersect = ((yi > pos.y) !== (yj > pos.y))
                && (pos.x < (xj - xi) * (pos.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
          }
          return inside;
        }
        return false;
      });
      
      if (clickedShape) {
        setSelectedShapeId(clickedShape.id);
        setActiveHandle(null);
        setIsDragging(true);
        setDragStart(pos);
        setDragShapeStart({
          ...clickedShape,
          points: clickedShape.points.map(p => ({ ...p }))
        });
      } else {
        setSelectedShapeId(null);
        setActiveHandle(null);
      }
    } else {
      setIsDrawing(true);
      setDrawingStart(pos);
      if (currentTool === 'polygon') {
        const tempShape = shapes.find(s => s.id.startsWith('temp-') && s.type === 'polygon');
        if (tempShape) {
          // Check if clicked near first point (within 20px)
          const firstPoint = tempShape.points[0];
          const distance = Math.sqrt(Math.pow(pos.x - firstPoint.x, 2) + Math.pow(pos.y - firstPoint.y, 2));
          
          if (distance < 20 && tempShape.points.length >= 3) {
            // Close the polygon
            const updatedPolygonCount = polygonCount + 1;
            setPolygonCount(updatedPolygonCount);
            
            setShapes(prev => {
              const filtered = prev.filter(s => s.id !== tempShape.id);
              const finalShape = {
                ...tempShape,
                id: createId(),
                label: `Polygon ${updatedPolygonCount}`
              };
              // Calculate bounding box
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              finalShape.points.forEach(p => {
                minX = Math.min(minX, p.x);
                minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x);
                maxY = Math.max(maxY, p.y);
              });
              finalShape.x = minX;
              finalShape.y = minY;
              finalShape.width = maxX - minX;
              finalShape.height = maxY - minY;
              return [...filtered, finalShape];
            });
            
            setIsDrawing(false);
            setDrawingStart(null);
            updateShapesAndHistory([...shapes.filter(s => s.id !== tempShape.id), {
              ...tempShape,
              id: createId(),
              label: `Polygon ${polygonCount + 1}`
            }]);
            
          } else {
            // Add another point
            setShapes(prev => prev.map(s => {
              if (s === tempShape) {
                return { ...s, points: [...s.points, pos] };
              }
              return s;
            }));
          }
        } else {
          setShapes(prev => [...prev, {
            id: `temp-${createId()}`,
            type: 'polygon',
            isPositive: true,
            points: [pos],
            x: pos.x,
            y: pos.y,
            width: 0,
            height: 0,
            radius: 0,
            visible: true,
            locked: false,
            label: '',
            opacity: 0.35
          }]);
        }
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
    
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.cursor = getCursorStyle(pos);
    }
    
    if (isDragging && dragShapeStart && dragStart) {
      const dx = pos.x - dragStart.x;
      const dy = pos.y - dragStart.y;
      
      setShapes(prev => prev.map(s => {
        if (s.id === selectedShapeId && activeHandle !== null) {
          const handle = parseInt(activeHandle);
          if (s.type === 'rectangle') {
            let newX = dragShapeStart.x;
            let newY = dragShapeStart.y;
            let newWidth = dragShapeStart.width;
            let newHeight = dragShapeStart.height;
            
            switch(handle) {
              case 0:
                newX = dragShapeStart.x + dx;
                newY = dragShapeStart.y + dy;
                newWidth = dragShapeStart.width - dx;
                newHeight = dragShapeStart.height - dy;
                break;
              case 1:
                newY = dragShapeStart.y + dy;
                newWidth = dragShapeStart.width + dx;
                newHeight = dragShapeStart.height - dy;
                break;
              case 2:
                newWidth = dragShapeStart.width + dx;
                newHeight = dragShapeStart.height + dy;
                break;
              case 3:
                newX = dragShapeStart.x + dx;
                newWidth = dragShapeStart.width - dx;
                newHeight = dragShapeStart.height + dy;
                break;
              case 4:
                newY = dragShapeStart.y + dy;
                newHeight = dragShapeStart.height - dy;
                break;
              case 5:
                newWidth = dragShapeStart.width + dx;
                break;
              case 6:
                newHeight = dragShapeStart.height + dy;
                break;
              case 7:
                newX = dragShapeStart.x + dx;
                newWidth = dragShapeStart.width - dx;
                break;
            }
            
            if (newWidth < 0) {
              newX += newWidth;
              newWidth = Math.abs(newWidth);
            }
            if (newHeight < 0) {
              newY += newHeight;
              newHeight = Math.abs(newHeight);
            }
            
            return { ...s, x: newX, y: newY, width: newWidth, height: newHeight };
          } else if (s.type === 'circle') {
            let newRadius = dragShapeStart.radius;
            switch(handle) {
              case 0: return { ...s, radius: dragShapeStart.radius - dy, y: dragShapeStart.y + dy/2 };
              case 1: return { ...s, radius: dragShapeStart.radius + dx, x: dragShapeStart.x + dx/2 };
              case 2: return { ...s, radius: dragShapeStart.radius + dy, y: dragShapeStart.y + dy/2 };
              case 3: return { ...s, radius: dragShapeStart.radius - dx, x: dragShapeStart.x + dx/2 };
              default: return s;
            }
          } else if (s.type === 'polygon') {
            const updatedPoints = [...s.points];
            if (updatedPoints[handle]) {
              updatedPoints[handle] = {
                x: dragShapeStart.points[handle].x + dx,
                y: dragShapeStart.points[handle].y + dy
              };
            }
            
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            updatedPoints.forEach(p => {
              minX = Math.min(minX, p.x);
              minY = Math.min(minY, p.y);
              maxX = Math.max(maxX, p.x);
              maxY = Math.max(maxY, p.y);
            });
            
            return { ...s, points: updatedPoints, x: minX, y: minY, width: maxX - minX, height: maxY - minY };
          }
          return s;
        } else if (s.id === selectedShapeId) {
          if (s.type === 'rectangle' || s.type === 'circle') {
            return { ...s, x: dragShapeStart.x + dx, y: dragShapeStart.y + dy };
          } else if (s.type === 'polygon') {
            return {
              ...s,
              x: dragShapeStart.x + dx,
              y: dragShapeStart.y + dy,
              points: s.points.map((p, idx) => ({
                x: dragShapeStart.points[idx].x + dx,
                y: dragShapeStart.points[idx].y + dy
              }))
            };
          }
        }
        return s;
      }));
    } else if (isDrawing && drawingStart && currentTool !== 'polygon') {
      const width = pos.x - drawingStart.x;
      const height = pos.y - drawingStart.y;
      
      return setShapes(prev => {
        const filtered = prev.filter(s => !s.id.startsWith('temp-'));
        
        if (currentTool === 'rectangle') {
          const newShape: Shape = {
            id: `temp-${createId()}`,
            type: 'rectangle',
            isPositive: true,
            points: [],
            x: width > 0 ? drawingStart.x : pos.x,
            y: height > 0 ? drawingStart.y : pos.y,
            width: Math.abs(width),
            height: Math.abs(height),
            radius: 0,
            visible: true,
            locked: false,
            label: '',
            opacity: 0.35
          };
          return [...filtered, newShape];
        } else if (currentTool === 'circle') {
          const radius = Math.sqrt(width*width + height*height);
          return [...filtered, {
            id: `temp-${createId()}`,
            type: 'circle',
            isPositive: true,
            points: [],
            x: drawingStart.x,
            y: drawingStart.y,
            width: 0,
            height: 0,
            radius,
            visible: true,
            locked: false,
            label: '',
            opacity: 0.35
          }];
        }
        
        return prev;
      });
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }

    const pos = getMousePos(e);
    
    if (isDragging) {
      setIsDragging(false);
      setDragStart(null);
      setDragShapeStart(null);
      setActiveHandle(null);
      updateShapesAndHistory(shapes);
    } else if (isDrawing && drawingStart && currentTool !== 'polygon') {
      // Update counts and labels
      let updatedRectCount = rectCount;
      let updatedCircleCount = circleCount;
      
      const finishedShapes = shapes.map(s => {
        if (s.id.startsWith('temp-')) {
          let newLabel = '';
          if (s.type === 'rectangle') {
            updatedRectCount++;
            newLabel = `Rectangle ${updatedRectCount}`;
          } else if (s.type === 'circle') {
            updatedCircleCount++;
            newLabel = `Circle ${updatedCircleCount}`;
          }
          return { ...s, id: createId(), label: newLabel };
        }
        return s;
      });
      
      if (updatedRectCount !== rectCount) setRectCount(updatedRectCount);
      if (updatedCircleCount !== circleCount) setCircleCount(updatedCircleCount);
      updateShapesAndHistory(finishedShapes);
      setIsDrawing(false);
      setDrawingStart(null);
    }
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const pos = getMousePos(e);
    
    const clickedShape = [...shapes].reverse().find(shape => {
      if (shape.visible === false) return false;
      if (shape.type === 'rectangle') {
        return pos.x >= shape.x && pos.x <= shape.x + shape.width && 
               pos.y >= shape.y && pos.y <= shape.y + shape.height;
      } else if (shape.type === 'circle') {
        const dx = pos.x - shape.x;
        const dy = pos.y - shape.y;
        return Math.sqrt(dx*dx + dy*dy) <= shape.radius;
      } else if (shape.type === 'polygon' && shape.points.length > 2) {
        let inside = false;
        const vs = shape.points;
        for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
          const xi = vs[i].x, yi = vs[i].y;
          const xj = vs[j].x, yj = vs[j].y;
          const intersect = ((yi > pos.y) !== (yj > pos.y))
              && (pos.x < (xj - xi) * (pos.y - yi) / (yj - yi) + xi);
          if (intersect) inside = !inside;
        }
        return inside;
      }
      return false;
    });
    
    if (clickedShape) {
      setSelectedShapeId(clickedShape.id);
      setContextMenu({ x: e.clientX, y: e.clientY, target: 'shape', shapeId: clickedShape.id });
    } else {
      setContextMenu({ x: e.clientX, y: e.clientY, target: 'canvas' });
    }
  };

  const getCursorStyle = (pos: Point): string => {
    if (isSpacePressed) return 'grab';
    if (selectedShapeId && !isDragging) {
      const selectedShape = shapes.find(s => s.id === selectedShapeId);
      if (selectedShape && selectedShape.visible !== false && !selectedShape.locked) {
        const handleCount = selectedShape.type === 'rectangle' ? 8 : (selectedShape.type === 'circle' ? 4 : selectedShape.points.length);
        for (let i = 0; i < handleCount; i++) {
          const handlePos = getHandlePosition(selectedShape, i);
          if (handlePos) {
            const dx = pos.x - handlePos.x;
            const dy = pos.y - handlePos.y;
            if (Math.sqrt(dx*dx + dy*dy) <= 10) {
              if (selectedShape.type === 'rectangle') {
                switch(i) {
                  case 0: return 'nwse-resize';
                  case 1: return 'nesw-resize';
                  case 2: return 'nwse-resize';
                  case 3: return 'nesw-resize';
                  case 4: return 'ns-resize';
                  case 5: return 'ew-resize';
                  case 6: return 'ns-resize';
                  case 7: return 'ew-resize';
                }
              } else if (selectedShape.type === 'circle') {
                switch(i) {
                  case 0: case 2: return 'ns-resize';
                  case 1: case 3: return 'ew-resize';
                }
              } else if (selectedShape.type === 'polygon') {
                return 'pointer';
              }
            }
          }
        }
        
        let inside = false;
        if (selectedShape.type === 'rectangle') {
          inside = pos.x >= selectedShape.x && pos.x <= selectedShape.x + selectedShape.width && 
                   pos.y >= selectedShape.y && pos.y <= selectedShape.y + selectedShape.height;
        } else if (selectedShape.type === 'circle') {
          const dx = pos.x - selectedShape.x;
          const dy = pos.y - selectedShape.y;
          inside = Math.sqrt(dx*dx + dy*dy) <= selectedShape.radius;
        } else if (selectedShape.type === 'polygon') {
          const vs = selectedShape.points;
          for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
            const xi = vs[i].x, yi = vs[i].y;
            const xj = vs[j].x, yj = vs[j].y;
            const intersect = ((yi > pos.y) !== (yj > pos.y))
                && (pos.x < (xj - xi) * (pos.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
          }
        }
        if (inside) return 'move';
      }
    }
    return currentTool === 'select' ? 'default' : 'crosshair';
  };

  // -------------------------------
  // Canvas Drawing
  // -------------------------------
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
      ctx.strokeStyle = 'rgba(37, 99, 235, 0.04)';
      ctx.lineWidth = 1;
      
      // Minor lines
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
      
      // Major lines
      ctx.strokeStyle = 'rgba(37, 99, 235, 0.10)';
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
    
    // Create a temporary canvas for shape union
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (tempCtx) {
      // Draw all shapes onto the temp canvas (union them)
      shapes.forEach(shape => {
        if (shape.visible === false) return;
        
        tempCtx.save();
        tempCtx.fillStyle = 'rgba(255, 255, 255, 1)';
        tempCtx.globalCompositeOperation = 'source-over';
        tempCtx.beginPath();
        
        if (shape.type === 'rectangle') {
          tempCtx.rect(shape.x, shape.y, shape.width, shape.height);
        } else if (shape.type === 'circle') {
          tempCtx.arc(shape.x, shape.y, shape.radius, 0, 2 * Math.PI);
        } else if (shape.type === 'polygon' && shape.points.length > 0) {
          tempCtx.moveTo(shape.points[0].x, shape.points[0].y);
          shape.points.slice(1).forEach(p => tempCtx.lineTo(p.x, p.y));
          tempCtx.closePath();
        }
        
        tempCtx.fill();
        tempCtx.restore();
      });
      
      // Draw the union shape with transparency
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.drawImage(tempCanvas, 0, 0);
      ctx.restore();
    }
    
    // Draw shape outlines and handles
    shapes.forEach(shape => {
      if (shape.visible === false) return;

      ctx.save();
      ctx.strokeStyle = 'rgba(37, 99, 235, 0.8)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      
      if (shape.type === 'rectangle') {
        ctx.rect(shape.x, shape.y, shape.width, shape.height);
      } else if (shape.type === 'circle') {
        ctx.arc(shape.x, shape.y, shape.radius, 0, 2 * Math.PI);
      } else if (shape.type === 'polygon' && shape.points.length > 0) {
        ctx.moveTo(shape.points[0].x, shape.points[0].y);
        shape.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
        ctx.closePath();
      }
      
      ctx.stroke();
      
      if (shape.id === selectedShapeId && !previewMode) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#2563EB';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        
        if (shape.type === 'rectangle') {
          ctx.strokeRect(shape.x - 4, shape.y - 4, shape.width + 8, shape.height + 8);
        } else if (shape.type === 'circle') {
          ctx.beginPath();
          ctx.arc(shape.x, shape.y, shape.radius + 4, 0, 2 * Math.PI);
          ctx.stroke();
        } else if (shape.type === 'polygon' && shape.points.length > 0) {
          ctx.beginPath();
          ctx.moveTo(shape.points[0].x, shape.points[0].y);
          shape.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
          ctx.closePath();
          ctx.stroke();
        }
        
        const handleSize = 8;
        ctx.fillStyle = 'white';
        ctx.strokeStyle = '#2563EB';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        
        const handleCount = shape.type === 'rectangle' ? 8 : (shape.type === 'circle' ? 4 : shape.points.length);
        for (let i = 0; i < handleCount; i++) {
          const h = getHandlePosition(shape, i);
          if (h) {
            ctx.fillRect(h.x - handleSize/2, h.y - handleSize/2, handleSize, handleSize);
            ctx.strokeRect(h.x - handleSize/2, h.y - handleSize/2, handleSize, handleSize);
          }
        }
      }
      
      ctx.restore();
    });



    
    // Polygon live preview line
    if (currentTool === 'polygon' && liveMousePos) {
      const tempPoly = shapes.find(s => s.id.startsWith('temp-') && s.type === 'polygon');
      if (tempPoly && tempPoly.points.length > 0) {
        ctx.save();
        ctx.globalAlpha = 1;
        
        // Draw line to current mouse pos
        ctx.strokeStyle = '#2563EB';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(tempPoly.points[tempPoly.points.length - 1].x, tempPoly.points[tempPoly.points.length - 1].y);
        ctx.lineTo(liveMousePos.x, liveMousePos.y);
        ctx.stroke();
        
        // Draw faint closing line to start
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = 'rgba(37, 99, 235, 0.35)';
        ctx.beginPath();
        ctx.moveTo(liveMousePos.x, liveMousePos.y);
        ctx.lineTo(tempPoly.points[0].x, tempPoly.points[0].y);
        ctx.stroke();
        
        // Draw vertex points
        ctx.setLineDash([]);
        tempPoly.points.forEach(p => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 5, 0, 2 * Math.PI);
          ctx.fillStyle = '#2563EB';
          ctx.fill();
          ctx.strokeStyle = 'white';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        });
        
        // Draw animated close indicator at first point
        const firstPt = tempPoly.points[0];
        ctx.save();
        ctx.beginPath();
        ctx.arc(firstPt.x, firstPt.y, 10, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(37, 99, 235, 0.3)';
        ctx.lineWidth = 3;
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(firstPt.x, firstPt.y, 8, 0, 2 * Math.PI);
        ctx.strokeStyle = '#2563EB';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        
        ctx.restore();
        return ctx.restore();
      }
    }
    
    // Preview mode overlay
    if (previewMode) {
      const offscreen = document.createElement('canvas');
      offscreen.width = canvas.width;
      offscreen.height = canvas.height;
      const oCtx = offscreen.getContext('2d')!;
      oCtx.fillStyle = 'black';
      oCtx.fillRect(0, 0, offscreen.width, offscreen.height);
      
      oCtx.globalCompositeOperation = 'source-over';
      oCtx.fillStyle = 'white';
      shapes.filter(s => s.isPositive && s.visible !== false).forEach(shape => {
        if (shape.type === 'rectangle') oCtx.rect(shape.x, shape.y, shape.width, shape.height);
        else if (shape.type === 'circle') oCtx.arc(shape.x, shape.y, shape.radius, 0, 2 * Math.PI);
        else if (shape.type === 'polygon' && shape.points.length > 0) {
          oCtx.moveTo(shape.points[0].x, shape.points[0].y);
          shape.points.slice(1).forEach(p => oCtx.lineTo(p.x, p.y));
          oCtx.closePath();
        }
        oCtx.fill();
      });
      
      oCtx.globalCompositeOperation = 'destination-out';
      oCtx.fillStyle = 'white';
      shapes.filter(s => !s.isPositive && s.visible !== false).forEach(shape => {
        if (shape.type === 'rectangle') oCtx.rect(shape.x, shape.y, shape.width, shape.height);
        else if (shape.type === 'circle') oCtx.arc(shape.x, shape.y, shape.radius, 0, 2 * Math.PI);
        else if (shape.type === 'polygon' && shape.points.length > 0) {
          oCtx.moveTo(shape.points[0].x, shape.points[0].y);
          shape.points.slice(1).forEach(p => oCtx.lineTo(p.x, p.y));
          oCtx.closePath();
        }
        oCtx.fill();
      });
      
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(offscreen, 0, 0);
      ctx.restore();
    }
    
  }, [shapes, selectedShapeId, previewMode, gridSnap, gridSize, liveMousePos, imageDimensions]);

  // -------------------------------
  // Effects & Initialization
  // -------------------------------
  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

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
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') {
        return;
      }
      
      setContextMenu(null);
      
      if (e.code === 'Space') {
        setIsSpacePressed(true);
        e.preventDefault();
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedShapeId) {
          const newShapes = shapes.filter(s => s.id !== selectedShapeId);
          updateShapesAndHistory(newShapes);
          setSelectedShapeId(null);
        }
      }

      if (e.key === 'Escape') {
        setSelectedShapeId(null);
        setIsDrawing(false);
        setDrawingStart(null);
        setShapes(prev => prev.filter(s => !s.id.startsWith('temp-')));
      }

      switch(e.key.toLowerCase()) {
        case 'v': return setCurrentTool('select');
        case 'r': return setCurrentTool('rectangle');
        case 'c': return setCurrentTool('circle');
        case 'p': return setCurrentTool('polygon');
        case 'g': return setGridSnap(!gridSnap);
        case 'tab': e.preventDefault(); return setPreviewMode(!previewMode);
        case 'l':
          if (selectedShapeId) {
            updateShapesAndHistory(shapes.map(s => s.id === selectedShapeId ? { ...s, locked: !s.locked } : s));
          }
          return;
      }
      
      if ((e.ctrlKey || e.metaKey)) {
        if (e.key.toLowerCase() === 'z') {
          e.preventDefault();
          handleUndo();
        } else if (e.key.toLowerCase() === 'y') {
          e.preventDefault();
          handleRedo();
        } else if (e.key.toLowerCase() === 'c') {
          if (selectedShapeId) {
            const shape = shapes.find(s => s.id === selectedShapeId);
            if (shape) setClipboardShape({ ...shape, points: shape.points.map(p => ({ ...p })) });
          }
        } else if (e.key.toLowerCase() === 'v') {
          if (clipboardShape) {
            const newShape = {
              ...clipboardShape,
              id: createId(),
              x: clipboardShape.x + 15,
              y: clipboardShape.y + 15,
              points: clipboardShape.points.map(p => ({ x: p.x + 15, y: p.y + 15 })),
              label: clipboardShape.label.replace(/\d+$/, (m: string) => (parseInt(m) + 1).toString()) || 'Pasted Shape'
            };
            updateShapesAndHistory([...shapes, newShape]);
            setSelectedShapeId(newShape.id);
            showToast('success', 'Shape pasted');
          }
        } else if (e.key.toLowerCase() === 'd') {
          if (selectedShapeId) {
            const shape = shapes.find(s => s.id === selectedShapeId);
            if (shape) {
              const newShape = {
                ...shape,
                id: createId(),
                x: shape.x + 15,
                y: shape.y + 15,
                points: shape.points.map(p => ({ x: p.x + 15, y: p.y + 15 })),
                label: shape.label.replace(/\d+$/, (m: string) => (parseInt(m) + 1).toString()) || 'Duplicate'
              };
              updateShapesAndHistory([...shapes, newShape]);
              setSelectedShapeId(newShape.id);
              showToast('success', 'Shape duplicated');
            }
          }
        } else if (e.key.toLowerCase() === 's') {
          e.preventDefault();
          handleSave();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };
    
    const handleOutsideClick = (e: MouseEvent) => {
      if (contextMenu) {
        setContextMenu(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('click', handleOutsideClick);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('click', handleOutsideClick);
    };
  }, [selectedShapeId, shapes, handleUndo, handleRedo, gridSnap, previewMode, contextMenu, clipboardShape]);

  useEffect(() => {
    if (!imageDimensions.width || !imageDimensions.height) return;
    
    let shapesToLoad: Shape[] = [];
    
    if (initialPoints && typeof initialPoints === 'object' && !Array.isArray(initialPoints) && 'shapes' in initialPoints) {
      if (initialPoints.shapes && Array.isArray(initialPoints.shapes)) {
        let localRectCount = rectCount;
        let localCircleCount = circleCount;
        let localPolyCount = polygonCount;
        
        shapesToLoad = initialPoints.shapes.map((s: any, i: number) => {
          const newId = createId();
          let newLabel = '';
          if (s.type === 'rectangle') { 
            localRectCount++; 
            newLabel = `Rectangle ${localRectCount}`; 
          }
          else if (s.type === 'circle') { 
            localCircleCount++; 
            newLabel = `Circle ${localCircleCount}`; 
          }
          else if (s.type === 'polygon') { 
            localPolyCount++; 
            newLabel = `Polygon ${localPolyCount}`; 
          }
          
          return {
            id: s.id || newId,
            type: s.type,
            isPositive: s.isPositive !== undefined ? s.isPositive : true,
            points: (s.points || []).map((p: any) => ({
              x: p.x * imageDimensions.width,
              y: p.y * imageDimensions.height
            })),
            x: s.x * imageDimensions.width || 0,
            y: s.y * imageDimensions.height || 0,
            width: s.width * imageDimensions.width || 0,
            height: s.height * imageDimensions.height || 0,
            radius: s.radius * Math.max(imageDimensions.width, imageDimensions.height) || 0,
            visible: s.visible !== undefined ? s.visible : true,
            locked: s.locked || false,
            label: s.label || newLabel,
            opacity: s.opacity || 0.35
          };
        });
        
        // Update state counts
        if (localRectCount !== rectCount) setRectCount(localRectCount);
        if (localCircleCount !== circleCount) setCircleCount(localCircleCount);
        if (localPolyCount !== polygonCount) setPolygonCount(localPolyCount);
      }
    } 
    else if (Array.isArray(initialPoints) && initialPoints.length > 0) {
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
      
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      denormalizedPoints.forEach(p => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      });
      
      shapesToLoad = [{
        id: 'initial',
        type: 'polygon',
        isPositive: true,
        points: denormalizedPoints,
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        radius: 0,
        visible: true,
        locked: false,
        label: 'Initial Region',
        opacity: 0.35
      }];
    }
    
    setShapes(shapesToLoad);
    setHistory([shapesToLoad.map(s => ({ ...s }))]);
    setHistoryIndex(0);
  }, [initialPoints, imageDimensions]);

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[100] p-4 pt-19 text-sm select-none" style={{ fontFamily: 'Inter, system-ui, sans-serif', backgroundColor: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(12px)' }}>
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
      
      {/* Context Menu */}
      {contextMenu && (
        <div 
          className="fixed z-[250] bg-white border border-[#DDE4F5] rounded-xl shadow-lg py-1 min-w-[180px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.target === 'shape' ? (
            <>
              <div 
                className="flex items-center gap-2.5 px-3 py-2 text-xs text-[#0F172A] hover:bg-[#F5F8FF] cursor-pointer"
                onClick={() => {
                  if (contextMenu.shapeId) {
                    const shape = shapes.find(s => s.id === contextMenu.shapeId);
                    if (shape) {
                      setEditingLabelId(contextMenu.shapeId);
                      setEditingLabelText(shape.label);
                    }
                  }
                  setContextMenu(null);
                }}
              >
                <Edit3 size={14} />
                <span>Rename</span>
              </div>
              
              <div 
                className="flex items-center gap-2.5 px-3 py-2 text-xs text-[#0F172A] hover:bg-[#F5F8FF] cursor-pointer"
                onClick={() => {
                  if (contextMenu.shapeId) {
                    const newShapes = shapes.map(s => 
                      s.id === contextMenu.shapeId ? { ...s, locked: !s.locked } : s
                    );
                    updateShapesAndHistory(newShapes);
                  }
                  setContextMenu(null);
                }}
              >
                {(() => {
                  const shape = shapes.find(s => s.id === contextMenu.shapeId);
                  return shape && shape.locked ? <Unlock size={14} /> : <Lock size={14} />;
                })()}
                <span>{(() => {
                  const shape = shapes.find(s => s.id === contextMenu.shapeId);
                  return shape && shape.locked ? "Unlock" : "Lock";
                })()}</span>
              </div>
              
              <div 
                className="flex items-center gap-2.5 px-3 py-2 text-xs text-[#0F172A] hover:bg-[#F5F8FF] cursor-pointer"
                onClick={() => {
                  if (contextMenu.shapeId) {
                    const shape = shapes.find(s => s.id === contextMenu.shapeId);
                    if (shape) setClipboardShape({ ...shape, points: shape.points.map(p => ({ ...p })) });
                  }
                  setContextMenu(null);
                }}
              >
                <Copy size={14} />
                <span>Duplicate</span>
              </div>
              
              <div className="h-px bg-[#DDE4F5] my-1"></div>
              
              <div 
                className="flex items-center gap-2.5 px-3 py-2 text-xs text-[#0F172A] hover:bg-[#F5F8FF] cursor-pointer"
                onClick={() => {
                  if (contextMenu.shapeId) {
                    moveLayer(contextMenu.shapeId, 'up');
                  }
                  setContextMenu(null);
                }}
              >
                <ArrowUp size={14} />
                <span>Bring to Front</span>
              </div>
              
              <div 
                className="flex items-center gap-2.5 px-3 py-2 text-xs text-[#0F172A] hover:bg-[#F5F8FF] cursor-pointer"
                onClick={() => {
                  if (contextMenu.shapeId) {
                    moveLayer(contextMenu.shapeId, 'down');
                  }
                  setContextMenu(null);
                }}
              >
                <ArrowDown size={14} />
                <span>Send to Back</span>
              </div>
              
              <div className="h-px bg-[#DDE4F5] my-1"></div>
              
              <div 
                className="flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-[#FEF2F2] cursor-pointer"
                style={{ color: '#DC2626' }}
                onClick={() => {
                  if (contextMenu.shapeId) {
                    const newShapes = shapes.filter(s => s.id !== contextMenu.shapeId);
                    updateShapesAndHistory(newShapes);
                    if (selectedShapeId === contextMenu.shapeId) setSelectedShapeId(null);
                  }
                  setContextMenu(null);
                }}
              >
                <Trash2 size={14} />
                <span>Delete</span>
              </div>
            </>
          ) : (
            <>
              <div 
                className="flex items-center gap-2.5 px-3 py-2 text-xs text-[#0F172A] hover:bg-[#F5F8FF] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ opacity: !clipboardShape ? 0.4 : 1, pointerEvents: !clipboardShape ? 'none' : 'auto' }}
                onClick={() => {
                  if (clipboardShape) {
                    const newShape = {
                      ...clipboardShape,
                      id: createId(),
                      x: clipboardShape.x + 15,
                      y: clipboardShape.y + 15,
                      points: clipboardShape.points.map(p => ({ x: p.x + 15, y: p.y + 15 })),
                      label: clipboardShape.label.replace(/\d+$/, (m: string) => (parseInt(m) + 1).toString()) || 'Pasted Shape'
                    };
                    updateShapesAndHistory([...shapes, newShape]);
                    setSelectedShapeId(newShape.id);
                    showToast('success', 'Shape pasted');
                  }
                  setContextMenu(null);
                }}
              >
                <Clipboard size={14} />
                <span>Paste</span>
              </div>
              
              <div 
                className="flex items-center gap-2.5 px-3 py-2 text-xs text-[#0F172A] hover:bg-[#F5F8FF] cursor-pointer"
                onClick={() => {
                  if (shapes.length > 0) {
                    const last = shapes[shapes.length - 1];
                    setSelectedShapeId(last.id);
                  }
                  setContextMenu(null);
                }}
              >
                <MousePointer size={14} />
                <span>Select All</span>
              </div>
              
              <div className="h-px bg-[#DDE4F5] my-1"></div>
              
              <div 
                className="flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-[#FEF2F2] cursor-pointer"
                style={{ color: '#DC2626' }}
                onClick={() => {
                  clearAll();
                  setContextMenu(null);
                }}
              >
                <RotateCcw size={14} />
                <span>Clear All</span>
              </div>
            </>
          )}
        </div>
      )}
      
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
                {activeMode === 'add' 
                  ? 'Draw positive boundary regions where scanned bags can be placed' 
                  : 'Draw negative boundary layers to mask off frames or pockets'}
              </p>
            </div>
            <button 
              onClick={() => setShowHelp(!showHelp)} 
              className="p-1.5 rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-[#F5F8FF] transition-all cursor-pointer border border-transparent hover:border-[#DDE4F5]"
              title="Show help & shortcuts"
            >
              <Info size={18} />
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
                <h3 className="font-semibold text-sm text-[#0F172A] mb-2 flex items-center gap-1">
                  <Info size={16} />
                  How to Use & Hotkeys
                </h3>
                <ul className="text-xs text-[#64748B] space-y-1">
                  <li>• <strong>Select (V)</strong>: Move shapes or drag handles / polygon vertices</li>
                  <li>• <strong>Rectangle (R)</strong> / <strong>Circle (C)</strong>: Drag on canvas to draw</li>
                  <li>• <strong>Polygon (P)</strong>: Click points, click "Finish Polygon" when done</li>
                  <li>• <strong>Pan Workspace</strong>: Middle click and drag OR hold Spacebar + drag</li>
                  <li>• <strong>Zoom to Cursor</strong>: Ctrl + scroll wheel</li>
                  <li>• <strong>Undo / Redo</strong>: Ctrl+Z / Ctrl+Y</li>
                  <li>• <strong>Delete selected</strong>: Del or Backspace</li>
                  <li>• <strong>Cancel drawing/deselect</strong>: Esc</li>
                  <li>• <strong>Save</strong>: Ctrl+S</li>
                  <li>• <strong>Preview mode</strong>: Tab or Preview button</li>
                  <li>• <strong>Grid snap</strong>: G to toggle</li>
                </ul>
              </div>
              <div>
                <h3 className="font-semibold text-sm text-[#0F172A] mb-2">Legend</h3>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-[rgba(37,99,235,0.35)] border border-[rgba(37,99,235,0.8)]"></div>
                    <span className="text-xs text-[#64748B]">Add Region (Positive Boundary)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-[rgba(220,38,38,0.35)] border border-[rgba(220,38,38,0.8)]"></div>
                    <span className="text-xs text-[#64748B]">Remove Region (Negative Mask)</span>
                  </div>
                </div>
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
              onClick={() => setCurrentTool('rectangle')}
              className={`p-2 rounded-lg transition-all border-none cursor-pointer ${currentTool === 'rectangle' ? 'bg-[#EFF4FF] text-[#2563EB] font-semibold border border-[#B8C8F0]' : 'text-[#64748B] hover:text-[#0F172A] hover:bg-white'}`}
              title="Rectangle (R)"
            >
              <Square size={18} />
            </button>
            <button
              onClick={() => setCurrentTool('circle')}
              className={`p-2 rounded-lg transition-all border-none cursor-pointer ${currentTool === 'circle' ? 'bg-[#EFF4FF] text-[#2563EB] font-semibold border border-[#B8C8F0]' : 'text-[#64748B] hover:text-[#0F172A] hover:bg-white'}`}
              title="Circle (C)"
            >
              <Circle size={18} />
            </button>
            <button
              onClick={() => setCurrentTool('polygon')}
              className={`p-2 rounded-lg transition-all border-none cursor-pointer ${currentTool === 'polygon' ? 'bg-[#EFF4FF] text-[#2563EB] font-semibold border border-[#B8C8F0]' : 'text-[#64748B] hover:text-[#0F172A] hover:bg-white'}`}
              title="Freehand Polygon (P)"
            >
              <Edit3 size={18} />
            </button>
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
            {selectedShapeId && (
              <button
                onClick={deleteSelectedShape}
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
              <RotateCcw size={14} className="inline mr-1" />
              Clear All
            </button>
          </div>
        </div>
        
        {/* Main Work Pane Row: Left is Canvas, Right is Layers */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left canvas area */}
          <div className="flex-[3] overflow-hidden bg-white relative flex items-center justify-center">
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
                  onContextMenu={handleContextMenu}
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
                      
                      const availableWidth = window.innerWidth * 0.55;
                      const availableHeight = window.innerHeight * 0.55;
                      const scaleX = availableWidth / img.width;
                      const scaleY = availableHeight / img.height;
                      const initialZoom = Math.min(Math.min(scaleX, scaleY), 2.0);
                      setZoom(initialZoom);
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
                      const availableWidth = window.innerWidth * 0.55;
                      const availableHeight = window.innerHeight * 0.55;
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

          {/* Right Layers List Sidebar */}
          <aside className="flex-1 bg-white border-l border-[#DDE4F5] flex flex-col overflow-hidden flex-shrink-0 min-w-[200px] max-w-[280px]">
            <div className="px-4 py-3 border-b border-[#DDE4F5] bg-white flex items-center justify-between">
              <h3 className="font-semibold text-[10px] uppercase tracking-widest text-[#64748B] flex items-center gap-1.5">
                <Layers size={14} className="text-[#2563EB]" />
                Active Regions
              </h3>
              <span className="text-[10px] font-mono text-[#64748B] bg-[#F5F8FF] px-2 py-0.5 rounded-full border border-[#DDE4F5]">
                {shapes.length}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {shapes.length === 0 ? (
                <div className="text-center py-12 text-xs text-[#64748B] leading-relaxed">
                  No boundary regions drawn yet. Select a drawing tool (Rectangle, Circle, Polygon) above to start.
                </div>
              ) : (
                [...shapes].reverse().map(shape => {
                  const isSelected = selectedShapeId === shape.id;
                  return (
                    <div
                      key={shape.id}
                      onClick={() => !shape.locked && setSelectedShapeId(shape.id)}
                      className={`flex flex-col px-3 py-2.5 rounded-xl border transition-all cursor-pointer ${
                        isSelected 
                          ? 'bg-[#EFF4FF] border-[#2563EB] shadow-sm ring-1 ring-[#2563EB]/10' 
                          : 'bg-white border-[#DDE4F5] hover:border-[#B8C8F0] hover:bg-[#F5F8FF]'
                      } ${shape.locked ? 'opacity-60 cursor-not-allowed' : ''}`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          {/* Positive/Negative color dot */}
                          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                            shape.isPositive ? 'bg-[#2563EB]' : 'bg-[#DC2626]'
                          }`} />
                          
                          {editingLabelId === shape.id ? (
                            <input
                              type="text"
                              className="flex-1 border border-[#B8C8F0] rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                              defaultValue={editingLabelText}
                              autoFocus
                              onBlur={(e) => {
                                updateShapesAndHistory(shapes.map(s => s.id === shape.id ? { ...s, label: e.target.value } : s));
                                setEditingLabelId(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  updateShapesAndHistory(shapes.map(s => s.id === shape.id ? { ...s, label: (e.target as HTMLInputElement).value } : s));
                                  setEditingLabelId(null);
                                } else if (e.key === 'Escape') {
                                  setEditingLabelId(null);
                                }
                              }}
                            />
                          ) : (
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-[#0F172A] capitalize truncate">
                                {shape.label}
                              </p>
                              <p className="text-[10px] text-[#64748B] font-medium uppercase tracking-wider">
                                {shape.isPositive ? 'Add Area' : 'Subtract Area'}
                              </p>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 ml-1">
                          {/* Move layer controls */}
                          <button
                            onClick={(e) => { e.stopPropagation(); moveLayer(shape.id, 'up'); }}
                            className="p-1 rounded text-[#64748B] hover:text-[#0F172A] hover:bg-[#F5F8FF] border-none bg-transparent cursor-pointer"
                            title="Bring to Front"
                          >
                            <ChevronUp size={14} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); moveLayer(shape.id, 'down'); }}
                            className="p-1 rounded text-[#64748B] hover:text-[#0F172A] hover:bg-[#F5F8FF] border-none bg-transparent cursor-pointer"
                            title="Send to Back"
                          >
                            <ChevronDown size={14} />
                          </button>
                          
                          {/* Toggle visibility */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const newShapes = shapes.map(s => {
                                if (s.id === shape.id) {
                                  return { ...s, visible: s.visible === false ? true : false };
                                }
                                return s;
                              });
                              updateShapesAndHistory(newShapes);
                            }}
                            className="p-1 rounded text-[#64748B] hover:text-[#0F172A] hover:bg-[#F5F8FF] border-none bg-transparent cursor-pointer"
                            title={shape.visible === false ? "Show region" : "Hide region"}
                          >
                            {shape.visible === false ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                          
                          {/* Lock */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              updateShapesAndHistory(shapes.map(s => 
                                s.id === shape.id ? { ...s, locked: !s.locked } : s
                              ));
                            }}
                            className="p-1 rounded text-[#64748B] hover:text-[#0F172A] hover:bg-[#F5F8FF] border-none bg-transparent cursor-pointer"
                            title={shape.locked ? "Unlock" : "Lock"}
                          >
                            {shape.locked ? <Unlock size={14} /> : <Lock size={14} />}
                          </button>
                          
                          {/* Expand/Collapse opacity */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedLayerId(expandedLayerId === shape.id ? null : shape.id);
                            }}
                            className="p-1 rounded text-[#64748B] hover:text-[#0F172A] hover:bg-[#F5F8FF] border-none bg-transparent cursor-pointer"
                            title="Opacity"
                          >
                            {expandedLayerId === shape.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                          
                          {/* Delete single */}
                          {!shape.locked && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const newShapes = shapes.filter(s => s.id !== shape.id);
                                updateShapesAndHistory(newShapes);
                                if (selectedShapeId === shape.id) {
                                  setSelectedShapeId(null);
                                }
                              }}
                              className="p-1 rounded text-[#64748B] hover:text-[#DC2626] hover:bg-[#FEF2F2] border-none bg-transparent cursor-pointer"
                              title="Delete region"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                      
                      {/* Opacity slider */}
                      {expandedLayerId === shape.id && (
                        <div className="mt-2 px-1">
                          <label className="text-[10px] text-[#64748B] font-medium">Opacity</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="range" min="0.1" max="1" step="0.05"
                              value={shape.opacity}
                              onChange={e => updateOpacity(shape.id, parseFloat(e.target.value))}
                              className="w-full accent-[#2563EB] mt-1"
                            />
                            <span className="text-[10px] font-mono text-[#2563EB]">{Math.round(shape.opacity * 100)}%</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        </div>
        
        {/* Status Bar */}
        <div className="px-5 py-2 border-t border-[#DDE4F5] bg-[#F5F8FF] flex items-center justify-between flex-shrink-0">
          <span className="text-xs text-[#64748B] flex items-center gap-1.5">
            <Layers size={14} />
            {shapes.length} Shape{shapes.length !== 1 ? 's' : ''}
            {zoom !== 1 && ` · Zoom: ${Math.round(zoom * 100)}%`}
            {(panOffset.x !== 0 || panOffset.y !== 0) && " · Panned"}
          </span>
          {selectedShapeId && (
            <span className="text-xs text-[#2563EB] font-medium flex items-center gap-1">
              <CheckCircle2 size={14} />
              Selected for edit
            </span>
          )}
        </div>
        
        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#DDE4F5] bg-white flex justify-between items-center flex-shrink-0">
          <button
            onClick={exportMask}
            className="px-4 py-2 border border-[#DDE4F5] text-[#64748B] hover:bg-[#F5F8FF] rounded-lg text-sm font-semibold transition-all cursor-pointer bg-white flex items-center gap-1.5"
          >
            <Download size={14} />
            Export Mask
          </button>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={() => {
                if (confirm("Are you sure you want to remove the entire valid region?")) {
                  onDelete();
                }
              }} 
              className="px-4 py-2 border border-[#FCA5A5] text-[#DC2626] hover:bg-[#FEF2F2] rounded-lg text-sm font-semibold transition-all cursor-pointer bg-white"
            >
              Remove Valid Region
            </button>
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
