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
  Maximize2
} from 'lucide-react';

interface Point {
  x: number;
  y: number;
}

type ShapeType = 'rectangle' | 'circle' | 'polygon';

interface Shape {
  id: string;
  type: ShapeType;
  isPositive: boolean; // true = add to region, false = subtract
  points: Point[];
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  visible?: boolean;
}

interface ValidRegionEditorProps {
  imageSrc: string;
  initialPoints: any;
  itemId: string;
  onSave: (points: Point[], shapes?: any[]) => void;
  onCancel: () => void;
}

const ValidRegionEditor: React.FC<ValidRegionEditorProps> = ({
  imageSrc,
  initialPoints,
  itemId,
  onSave,
  onCancel
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
  const imgRef = useRef<HTMLImageElement>(null);

  // Zoom & Pan state
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);

  // Undo/Redo history stacks
  const [history, setHistory] = useState<Shape[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Helper: push status to history stack
  const updateShapesAndHistory = (newShapes: Shape[]) => {
    const cleanShapes = newShapes.filter(s => !s.id.startsWith('temp-'));
    const nextHistory = history.slice(0, historyIndex + 1);
    nextHistory.push(cleanShapes);
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
    setShapes(newShapes);
  };

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      setHistoryIndex(prevIndex);
      setShapes(history[prevIndex]);
      setSelectedShapeId(null);
    }
  }, [history, historyIndex]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      setShapes(history[nextIndex]);
      setSelectedShapeId(null);
    }
  }, [history, historyIndex]);

  // Keyboard hotkeys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') {
        return;
      }

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

      // Quick Tool Switching
      if (e.key.toLowerCase() === 'v') {
        setCurrentTool('select');
      } else if (e.key.toLowerCase() === 'r') {
        setCurrentTool('rectangle');
      } else if (e.key.toLowerCase() === 'c') {
        setCurrentTool('circle');
      } else if (e.key.toLowerCase() === 'p') {
        setCurrentTool('polygon');
      }

      // Undo/Redo Shortcuts
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [selectedShapeId, shapes, handleUndo, handleRedo]);

  // Initialize with initial points if available
  useEffect(() => {
    if (!imageDimensions.width || !imageDimensions.height) return;
    
    let shapesToLoad: Shape[] = [];
    
    if (initialPoints && typeof initialPoints === 'object' && !Array.isArray(initialPoints) && 'shapes' in initialPoints) {
      if (initialPoints.shapes && Array.isArray(initialPoints.shapes)) {
        shapesToLoad = initialPoints.shapes.map((s: any, i: number) => ({
          id: `loaded-${i}`,
          type: s.type,
          isPositive: s.isPositive,
          points: (s.points || []).map((p: any) => ({
            x: p.x * imageDimensions.width,
            y: p.y * imageDimensions.height
          })),
          x: s.x * imageDimensions.width || 0,
          y: s.y * imageDimensions.height || 0,
          width: s.width * imageDimensions.width || 0,
          height: s.height * imageDimensions.height || 0,
          radius: s.radius * Math.max(imageDimensions.width, imageDimensions.height) || 0,
          visible: true
        }));
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
        visible: true
      }];
    }
    
    setShapes(shapesToLoad);
    setHistory([shapesToLoad.map(s => ({ ...s }))]);
    setHistoryIndex(0);
  }, [initialPoints, imageDimensions]);

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

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!imgRef.current) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();
    ctx.translate(panOffset.x, panOffset.y);
    ctx.scale(zoom, zoom);
    
    ctx.drawImage(imgRef.current, 0, 0);
    
    shapes.forEach(shape => {
      if (shape.visible === false) return;

      ctx.save();
      
      if (shape.isPositive) {
        ctx.fillStyle = 'rgba(59, 130, 246, 0.35)';
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
      } else {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.35)';
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
      }
      
      // Scale line width inverse to zoom to keep boundaries clean
      ctx.lineWidth = 2.5 / zoom;
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
      
      if (shape.id === selectedShapeId) {
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 2 / zoom;
        ctx.setLineDash([5 / zoom, 4 / zoom]);
        
        if (shape.type === 'rectangle') {
          ctx.strokeRect(shape.x - 4 / zoom, shape.y - 4 / zoom, shape.width + 8 / zoom, shape.height + 8 / zoom);
        } else if (shape.type === 'circle') {
          ctx.beginPath();
          ctx.arc(shape.x, shape.y, shape.radius + 4 / zoom, 0, 2 * Math.PI);
          ctx.stroke();
        } else if (shape.type === 'polygon' && shape.points.length > 0) {
          ctx.beginPath();
          ctx.moveTo(shape.points[0].x, shape.points[0].y);
          shape.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
          ctx.closePath();
          ctx.stroke();
        }
        
        const handleSize = 8 / zoom;
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 1.5 / zoom;
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
    
    ctx.restore();
  }, [shapes, selectedShapeId, zoom, panOffset]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  // Translate screen mouse positions to Canvas coordinates accounting for Zoom and Pan
  const getMousePos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;
    
    return {
      x: (mouseX - panOffset.x) / zoom,
      y: (mouseY - panOffset.y) / zoom
    };
  };

  const createId = () => Math.random().toString(36).substr(2, 9);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getMousePos(e);
    
    // Middle click or Spacebar+Left click to pan
    if (e.button === 1 || isSpacePressed) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
      e.preventDefault();
      return;
    }

    if (currentTool === 'select' || currentTool === 'move') {
      if (selectedShapeId) {
        const selectedShape = shapes.find(s => s.id === selectedShapeId);
        if (selectedShape && selectedShape.visible !== false) {
          const handleCount = selectedShape.type === 'rectangle' ? 8 : (selectedShape.type === 'circle' ? 4 : selectedShape.points.length);
          for (let i = 0; i < handleCount; i++) {
            const handlePos = getHandlePosition(selectedShape, i);
            if (handlePos) {
              const dx = pos.x - handlePos.x;
              const dy = pos.y - handlePos.y;
              if (Math.sqrt(dx*dx + dy*dy) <= 10 / zoom) {
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
        }
      }
      
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
          // Ray-casting algorithm to determine if point is inside polygon
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
    }
  };

  const getCursorStyle = (pos: Point): string => {
    if (isSpacePressed) return 'grab';
    if (selectedShapeId && !isDragging) {
      const selectedShape = shapes.find(s => s.id === selectedShapeId);
      if (selectedShape && selectedShape.visible !== false) {
        const handleCount = selectedShape.type === 'rectangle' ? 8 : (selectedShape.type === 'circle' ? 4 : selectedShape.points.length);
        for (let i = 0; i < handleCount; i++) {
          const handlePos = getHandlePosition(selectedShape, i);
          if (handlePos) {
            const dx = pos.x - handlePos.x;
            const dy = pos.y - handlePos.y;
            if (Math.sqrt(dx*dx + dy*dy) <= 10 / zoom) {
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
        
        // Check if inside shape
        let inside = false;
        if (selectedShape.type === 'rectangle') {
          inside = pos.x >= selectedShape.x && pos.x <= selectedShape.x + selectedShape.width && 
                   pos.y >= selectedShape.y && pos.y <= selectedShape.y + selectedShape.height;
        } else if (selectedShape.type === 'circle') {
          const dx = pos.x - selectedShape.x;
          const dy = pos.y - selectedShape.y;
          inside = Math.sqrt(dx*dx + dy*dy) <= selectedShape.radius;
        } else if (selectedShape.type === 'polygon') {
          let polyInside = false;
          const vs = selectedShape.points;
          for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
            const xi = vs[i].x, yi = vs[i].y;
            const xj = vs[j].x, yj = vs[j].y;
            const intersect = ((yi > pos.y) !== (yj > pos.y))
                && (pos.x < (xj - xi) * (pos.y - yi) / (yj - yi) + xi);
            if (intersect) polyInside = !polyInside;
          }
          inside = polyInside;
        }

        if (inside) return 'move';
      }
    }
    return currentTool === 'select' ? 'default' : 'crosshair';
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
              case 0: newRadius = dragShapeStart.radius - dy; break;
              case 1: newRadius = dragShapeStart.radius + dx; break;
              case 2: newRadius = dragShapeStart.radius + dy; break;
              case 3: newRadius = dragShapeStart.radius - dx; break;
            }
            newRadius = Math.max(10, newRadius);
            return { ...s, radius: newRadius };
          } else if (s.type === 'polygon') {
            const updatedPoints = [...s.points];
            if (updatedPoints[handle]) {
              updatedPoints[handle] = {
                x: dragShapeStart.points[handle].x + dx,
                y: dragShapeStart.points[handle].y + dy
              };
            }
            
            // Re-calculate bounds (x, y, width, height) based on new point locations
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            updatedPoints.forEach(p => {
              minX = Math.min(minX, p.x);
              minY = Math.min(minY, p.y);
              maxX = Math.max(maxX, p.x);
              maxY = Math.max(maxY, p.y);
            });

            return { 
              ...s, 
              points: updatedPoints,
              x: minX,
              y: minY,
              width: maxX - minX,
              height: maxY - minY
            };
          }
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
      
      setShapes(prev => {
        const filtered = prev.filter(s => !s.id.startsWith('temp-'));
        
        if (currentTool === 'rectangle') {
          return [...filtered, {
            id: `temp-${createId()}`,
            type: 'rectangle',
            isPositive: activeMode === 'add',
            points: [],
            x: width > 0 ? drawingStart.x : pos.x,
            y: height > 0 ? drawingStart.y : pos.y,
            width: Math.abs(width),
            height: Math.abs(height),
            radius: 0,
            visible: true
          }];
        } else if (currentTool === 'circle') {
          const radius = Math.sqrt(width*width + height*height);
          return [...filtered, {
            id: `temp-${createId()}`,
            type: 'circle',
            isPositive: activeMode === 'add',
            points: [],
            x: drawingStart.x,
            y: drawingStart.y,
            width: 0,
            height: 0,
            radius,
            visible: true
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
      const finishedShapes = shapes.map(s => {
        if (s.id.startsWith('temp-')) {
          return { ...s, id: createId() };
        }
        return s;
      });
      updateShapesAndHistory(finishedShapes);
    } else if (isDrawing && currentTool === 'polygon') {
      setShapes(prev => {
        let lastPolygon = prev.find(s => s.id.startsWith('temp-') && s.type === 'polygon');
        
        if (!lastPolygon) {
          return [...prev, {
            id: `temp-${createId()}`,
            type: 'polygon',
            isPositive: activeMode === 'add',
            points: [pos],
            x: pos.x,
            y: pos.y,
            width: 0,
            height: 0,
            radius: 0,
            visible: true
          }];
        }
        
        return prev.map(s => {
          if (s === lastPolygon) {
            return { ...s, points: [...s.points, pos] };
          }
          return s;
        });
      });
    }
    
    setIsDrawing(false);
    setDrawingStart(null);
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
        return { 
          ...s, 
          id: createId(),
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY
        };
      }
      return s;
    });
    updateShapesAndHistory(finishedShapes);
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

  const toggleShapeVisibility = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newShapes = shapes.map(s => {
      if (s.id === id) {
        return { ...s, visible: s.visible === false ? true : false };
      }
      return s;
    });
    updateShapesAndHistory(newShapes);
  };

  const handleSave = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const normalizedShapes = shapes.map(shape => {
      const normalized: any = {
        type: shape.type,
        isPositive: shape.isPositive
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
    } catch (e) {
      console.error('Error saving:', e);
    }
    
    onSave(simplifiedPoints, normalizedShapes);
  };

  return (
    <div className="fixed inset-0 bg-ink/55 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in text-sm select-none">
      <div className="bg-panel rounded-2xl shadow-panel border border-border max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border bg-nav flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="font-bold text-base text-ink">Edit Valid Placement Region</h2>
              <p className="text-xs text-muted mt-0.5">
                {activeMode === 'add' 
                  ? 'Draw positive boundary regions where scanned bags can be placed' 
                  : 'Draw negative boundary layers to mask off frames or pockets'}
              </p>
            </div>
            <button 
              onClick={() => setShowHelp(!showHelp)} 
              className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-surface transition-all cursor-pointer"
              title="Show help & shortcuts"
            >
              <Info size={18} />
            </button>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-surface transition-all cursor-pointer">
            <X size={20} />
          </button>
        </div>

        {/* Help Panel */}
        {showHelp && (
          <div className="px-6 py-4 border-b border-border bg-gradient-to-r from-blue-50/50 to-indigo-50/50 flex-shrink-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h3 className="font-semibold text-sm text-ink mb-2 flex items-center gap-1">
                  <Info size={16} />
                  How to Use & Hotkeys
                </h3>
                <ul className="text-xs text-muted space-y-1">
                  <li>• <strong>Select (V)</strong>: Move shapes or drag handles / polygon vertices</li>
                  <li>• <strong>Rectangle (R)</strong> / <strong>Circle (C)</strong>: Drag on canvas to draw</li>
                  <li>• <strong>Polygon (P)</strong>: Click points, click "Finish Polygon" when done</li>
                  <li>• <strong>Pan Workspace</strong>: Middle click and drag OR hold Spacebar + drag</li>
                  <li>• <strong>Undo / Redo</strong>: <kbd className="bg-surface px-1 border border-border rounded font-mono">Ctrl+Z</kbd> / <kbd className="bg-surface px-1 border border-border rounded font-mono">Ctrl+Y</kbd></li>
                  <li>• <strong>Delete selected</strong>: <kbd className="bg-surface px-1 border border-border rounded font-mono">Del</kbd> or <kbd className="bg-surface px-1 border border-border rounded font-mono">Backspace</kbd></li>
                  <li>• <strong>Cancel drawing/deselect</strong>: <kbd className="bg-surface px-1 border border-border rounded font-mono">Esc</kbd></li>
                </ul>
              </div>
              <div>
                <h3 className="font-semibold text-sm text-ink mb-2">Legend</h3>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-blue-500/40 border border-blue-500"></div>
                    <span className="text-xs text-muted">Add Region (Positive Boundary)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-rose-500/40 border border-rose-500"></div>
                    <span className="text-xs text-muted">Remove Region (Negative Mask)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Toolbar */}
        <div className="p-4 border-b border-border bg-panel flex flex-wrap gap-4 items-center flex-shrink-0">
          {/* Tools Grid */}
          <div className="flex items-center gap-1 bg-surface border border-border rounded-xl p-1">
            <button
              onClick={() => setCurrentTool('select')}
              className={`p-2 rounded-lg transition-all border-none bg-transparent cursor-pointer ${currentTool === 'select' ? 'bg-accent/10 text-accent font-semibold' : 'text-muted hover:text-ink hover:bg-panel'}`}
              title="Select (V)"
            >
              <Move size={18} />
            </button>
            <button
              onClick={() => setCurrentTool('rectangle')}
              className={`p-2 rounded-lg transition-all border-none bg-transparent cursor-pointer ${currentTool === 'rectangle' ? 'bg-accent/10 text-accent font-semibold' : 'text-muted hover:text-ink hover:bg-panel'}`}
              title="Rectangle (R)"
            >
              <Square size={18} />
            </button>
            <button
              onClick={() => setCurrentTool('circle')}
              className={`p-2 rounded-lg transition-all border-none bg-transparent cursor-pointer ${currentTool === 'circle' ? 'bg-accent/10 text-accent font-semibold' : 'text-muted hover:text-ink hover:bg-panel'}`}
              title="Circle (C)"
            >
              <Circle size={18} />
            </button>
            <button
              onClick={() => setCurrentTool('polygon')}
              className={`p-2 rounded-lg transition-all border-none bg-transparent cursor-pointer ${currentTool === 'polygon' ? 'bg-accent/10 text-accent font-semibold' : 'text-muted hover:text-ink hover:bg-panel'}`}
              title="Freehand Polygon (P)"
            >
              <Edit3 size={18} />
            </button>
          </div>
          
          {/* Mode toggle */}
          <div className="flex items-center gap-1.5 bg-surface border border-border rounded-xl p-1">
            <button
              onClick={() => setActiveMode('add')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border cursor-pointer ${activeMode === 'add' ? 'bg-emerald-50 text-emerald-800 border-emerald-200 shadow-sm' : 'bg-transparent border-transparent text-muted hover:text-ink'}`}
            >
              <Plus size={14} className="inline mr-1 stroke-[2.5]" />
              Add
            </button>
            <button
              onClick={() => setActiveMode('remove')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border cursor-pointer ${activeMode === 'remove' ? 'bg-rose-50 text-rose-800 border-rose-200 shadow-sm' : 'bg-transparent border-transparent text-muted hover:text-ink'}`}
            >
              <Minus size={14} className="inline mr-1 stroke-[2.5]" />
              Remove
            </button>
          </div>
          
          {/* Polygon finish */}
          {currentTool === 'polygon' && (
            <button
              onClick={finishPolygon}
              className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-xl text-xs font-semibold border border-blue-200 hover:bg-blue-100 cursor-pointer"
            >
              Finish Polygon
            </button>
          )}

          {/* Internal Undo/Redo */}
          <div className="flex items-center gap-1 bg-surface border border-border rounded-xl p-1">
            <button
              onClick={handleUndo}
              disabled={historyIndex <= 0}
              className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-panel disabled:opacity-35 transition-all bg-transparent border-none cursor-pointer"
              title="Undo"
            >
              <Undo2 size={16} />
            </button>
            <button
              onClick={handleRedo}
              disabled={historyIndex >= history.length - 1}
              className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-panel disabled:opacity-35 transition-all bg-transparent border-none cursor-pointer"
              title="Redo"
            >
              <Redo2 size={16} />
            </button>
          </div>
          
          {/* Actions */}
          <div className="flex items-center gap-2 ml-auto">
            {selectedShapeId && (
              <button
                onClick={deleteSelectedShape}
                className="px-3 py-1.5 bg-rose-50 text-rose-700 rounded-xl text-xs font-semibold border border-rose-200 hover:bg-rose-100 transition-all cursor-pointer"
              >
                <Trash2 size={14} className="inline mr-1" />
                Delete Selected
              </button>
            )}
            <button
              onClick={clearAll}
              className="px-3 py-1.5 bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold border border-border hover:bg-surface transition-all cursor-pointer"
            >
              <RotateCcw size={14} className="inline mr-1" />
              Clear All
            </button>
          </div>
        </div>
        
        {/* Main Work Pane Row: Left is Canvas, Right is Layers */}
        <div className="flex flex-1 overflow-hidden min-h-[450px]">
          {/* 1. Left canvas area */}
          <div className="flex-1 overflow-hidden bg-surface relative flex items-center justify-center p-6">
            <div className="relative shadow-panel rounded-xl overflow-hidden bg-white border border-border">
              <canvas
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                className={currentTool === 'select' ? 'cursor-default' : 'cursor-crosshair'}
              />
              <img
                ref={imgRef}
                src={imageSrc}
                alt=""
                className="hidden"
                onLoad={(e) => {
                  const img = e.target as HTMLImageElement;
                  setImageDimensions({ width: img.width, height: img.height });
                  const canvas = canvasRef.current;
                  if (canvas) {
                    canvas.width = img.width;
                    canvas.height = img.height;
                    drawCanvas();
                  }
                }}
              />
            </div>

            {/* Floating Zoom Controls */}
            <div className="absolute bottom-4 right-4 flex gap-1 z-10 shadow-card bg-panel/90 p-1 rounded-xl border border-border">
              <button
                onClick={() => setZoom(prev => Math.min(4, prev + 0.15))}
                className="w-7 h-7 bg-transparent border-none rounded-lg flex items-center justify-center text-muted hover:text-ink cursor-pointer hover:bg-surface transition-colors"
                title="Zoom In"
              >
                <ZoomIn size={15} />
              </button>
              <button
                onClick={() => setZoom(prev => Math.max(0.5, prev - 0.15))}
                className="w-7 h-7 bg-transparent border-none rounded-lg flex items-center justify-center text-muted hover:text-ink cursor-pointer hover:bg-surface transition-colors"
                title="Zoom Out"
              >
                <ZoomOut size={15} />
              </button>
              <button
                onClick={() => {
                  setZoom(1);
                  setPanOffset({ x: 0, y: 0 });
                }}
                className="w-7 h-7 bg-transparent border-none rounded-lg flex items-center justify-center text-muted hover:text-ink cursor-pointer hover:bg-surface transition-colors"
                title="Reset Workspace"
              >
                <Maximize2 size={15} />
              </button>
            </div>
          </div>

          {/* 2. Right Layers List Sidebar */}
          <aside className="w-64 border-l border-border bg-nav flex flex-col overflow-hidden flex-shrink-0">
            <div className="px-4 py-3 border-b border-border bg-panel flex items-center justify-between">
              <h3 className="font-semibold text-ink text-xs uppercase tracking-wider flex items-center gap-1.5">
                <Layers size={14} className="text-accent" />
                Active Regions
              </h3>
              <span className="text-[10px] font-mono text-muted bg-surface px-2 py-0.5 rounded-full border border-border">
                {shapes.length}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {shapes.length === 0 ? (
                <div className="text-center py-12 text-xs text-muted leading-relaxed">
                  No boundary regions drawn yet. Select a drawing tool (Rectangle, Circle, Polygon) above to start.
                </div>
              ) : (
                [...shapes].reverse().map((shape) => {
                  const isSelected = selectedShapeId === shape.id;
                  return (
                    <div
                      key={shape.id}
                      onClick={() => setSelectedShapeId(shape.id)}
                      className={`flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all cursor-pointer ${
                        isSelected 
                          ? "bg-panel border-accent shadow-card ring-1 ring-accent/10" 
                          : "bg-panel border-border hover:border-accent/40"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {/* Positive/Negative color dot */}
                        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                          shape.isPositive ? "bg-blue-500" : "bg-rose-500"
                        }`} />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-ink capitalize truncate">
                            {shape.type} Region
                          </p>
                          <p className="text-[10px] text-muted font-medium uppercase tracking-wider">
                            {shape.isPositive ? "Add Area" : "Subtract Area"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {/* Toggle visibility */}
                        <button
                          onClick={(e) => toggleShapeVisibility(shape.id, e)}
                          className="p-1 rounded text-muted hover:text-ink hover:bg-surface border-none bg-transparent cursor-pointer"
                          title={shape.visible === false ? "Show region" : "Hide region"}
                        >
                          {shape.visible === false ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                        {/* Delete single */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const newShapes = shapes.filter(s => s.id !== shape.id);
                            updateShapesAndHistory(newShapes);
                            if (selectedShapeId === shape.id) {
                              setSelectedShapeId(null);
                            }
                          }}
                          className="p-1 rounded text-muted hover:text-rose-600 hover:bg-rose-50 border-none bg-transparent cursor-pointer"
                          title="Delete region"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        </div>
        
        {/* Status Bar */}
        <div className="px-6 py-2 border-t border-border bg-surface flex items-center justify-between flex-shrink-0">
          <span className="text-xs text-muted flex items-center gap-1.5">
            <Layers size={14} />
            {shapes.length} Shape{shapes.length !== 1 ? 's' : ''}
            {zoom !== 1 && ` · Zoom: ${Math.round(zoom * 100)}%`}
            {(panOffset.x !== 0 || panOffset.y !== 0) && " · Panned"}
          </span>
          {selectedShapeId && (
            <span className="text-xs text-accent font-medium flex items-center gap-1">
              <CheckCircle2 size={14} />
              Selected for edit
            </span>
          )}
        </div>
        
        {/* Footer */}
        <div className="px-6 py-4 border-t border-border bg-nav flex justify-end gap-3 flex-shrink-0">
          <button 
            onClick={onCancel} 
            className="px-4 py-2 border border-border text-muted hover:bg-surface hover:text-ink rounded-xl text-sm font-semibold transition-all cursor-pointer bg-panel"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave} 
            className="px-5 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-accent to-accent-sky shadow-btn hover:shadow-btn-hover hover:opacity-95 transition-all flex items-center gap-1.5 text-sm cursor-pointer"
          >
            <Check size={15} />
            Save Region
          </button>
        </div>
      </div>
    </div>
  );
};

export default ValidRegionEditor;
