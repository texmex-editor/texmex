import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import React, { useState } from 'react';

interface TableSizePickerProps {
  onInsert: (rows: number, cols: number) => void;
  onDragStart?: (
    event: React.DragEvent<HTMLButtonElement>,
    rows: number,
    cols: number,
  ) => void;
}

const GRID_SIZE = 10;

export const TableSizePicker: React.FC<TableSizePickerProps> = ({
  onInsert,
  onDragStart,
}) => {
  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(2);
  const [hoverRows, setHoverRows] = useState(2);
  const [hoverCols, setHoverCols] = useState(2);

  const handleCellHover = (row: number, col: number) => {
    setHoverRows(row);
    setHoverCols(col);
  };

  const handleCellClick = (row: number, col: number) => {
    setRows(row);
    setCols(col);
    onInsert(row, col);
  };

  return (
    <Popover>
      <PopoverTrigger>
        <Button
          type="button"
          variant="outline"
          size="sm"
          draggable
          onDragStart={(event) => onDragStart?.(event, rows, cols)}
          className="h-auto flex-col items-start gap-1 rounded-xl p-3 text-left w-full"
        >
          <span className="font-mono text-[11px] text-muted-foreground">⊞</span>
          <span className="text-xs text-foreground">Table</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-4" side="bottom" align="start" sideOffset={12}>
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Table size</h3>
            
            {/* Grid selector */}
            <div className="inline-block border border-border rounded">
              {Array.from({ length: GRID_SIZE }).map((_, rowIdx) => (
                <div key={`row-${rowIdx}`} className="flex">
                  {Array.from({ length: GRID_SIZE }).map((_, colIdx) => (
                    <button
                      key={`cell-${rowIdx}-${colIdx}`}
                      type="button"
                      className={`w-6 h-6 border border-border transition-colors ${
                        rowIdx < hoverRows && colIdx < hoverCols
                          ? 'bg-primary'
                          : 'bg-muted hover:bg-muted-foreground/20'
                      }`}
                      onMouseEnter={() => handleCellHover(rowIdx + 1, colIdx + 1)}
                      onClick={() => handleCellClick(rowIdx + 1, colIdx + 1)}
                      aria-label={`Select ${rowIdx + 1} rows and ${colIdx + 1} columns`}
                    />
                  ))}
                </div>
              ))}
            </div>

            {/* Size display */}
            <div className="mt-3 text-sm text-muted-foreground">
              {hoverRows} × {hoverCols} table
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
